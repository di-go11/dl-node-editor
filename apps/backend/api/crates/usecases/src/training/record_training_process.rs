use crate::training::RecordError;
use crate::training::TrainingProgressProvider;
use crate::training::TrainingRecordReader;

use super::RepositoryError;

use entities::training::TrainingJobStatus;
use entities::training::TrainingProcess;
use entities::training::config::TrainingConfig;
use entities::training::{JobId, ModelId};

// 指定したエポックより後の「全エポック」を飛ばさずに受け取るためのポート(DBへの履歴保存用)。
// 途中のエポックはRUNNINGで届き、学習が終了したら最後に終了状態が1回だけ届く。

pub trait TrainingRunRegistar {
    // 新しいモデルをmodelテーブルにinsertする処理。training_runsが外部キーで参照するため先に呼ぶ。
    fn insert_model(
        &self,
        model_id: &ModelId,
        model_name: &str,
    ) -> impl Future<Output = Result<(), RecordError>> + Send;
    // 学習開始時の情報をtraining_runテーブルのinsertする処理。
    fn insert_training_run(
        &self,
        job_id: &JobId,
        config: &TrainingConfig,
        model_id: &ModelId,
    ) -> impl Future<Output = Result<(), RecordError>> + Send;
    // 学習終了時にupdateする処理
    fn update_training_run(
        &self,
        job_id: &JobId,
        status: &TrainingJobStatus,
    ) -> impl Future<Output = Result<(), RecordError>> + Send;
}
pub trait TrainingProgressRecorder {
    fn insert_epoch(
        &self,
        job_id: &JobId,
        epoch: u32,
        process: &TrainingProcess,
    ) -> impl Future<Output = Result<(), RecordError>> + Send;
}

// 2つのユースケースをまとめて1つにする
// 一つは,gRPCからストリームを受け取るユースケース
// もう一つは,受け取ったストリームをDBに保存するユースケース
// これらのユースケースを一つのトレイトとして実装すると責務が大きくなるため、2つに分けそれをユースケース内のimplでまとめる。
pub struct RecordTrainingProgress<S, R> {
    provider: S,
    repository: R,
}

// 保存済みエポック数を確認して現在まで送られてきたエポックデータを保存。
use futures_util::StreamExt;
use std::format;
use std::pin::pin;
impl<
    P: TrainingProgressProvider,
    R: TrainingProgressRecorder + TrainingRecordReader + TrainingRunRegistar,
> RecordTrainingProgress<P, R>
{
    pub async fn execute(
        &self,
        job_id: &JobId,
        config: &TrainingConfig,
    ) -> Result<(), RecordError> {
        //すでに保存されているepochについて調べる。
        let after_epoch = self
            .repository
            .last_saved_epoch(job_id)
            .await
            .map_err(|e| RecordError::LastSavedEpochFailed(e.to_string()))?;

        // c++のサーバーから何らかの方法でStreamをかけられてepoch毎のデータをもらう。
        let stream = self
            .provider
            .stream_epoch_after(job_id, after_epoch)
            .await
            .map_err(RecordError::StreamOpenFailed)?; // 開く段階の失敗(外側のErr)
        let mut stream = pin!(stream); //StreamExt::next()はSelf:Upin（StreamExtフィールド内としてコンポジットしている)で固定する決まり。pin!()で値ムーブをこのスコープないだけで禁止にする。

        // 受け取ったStreamをDBに保存する。
        while let Some(process) = stream.next().await {
            // 途中で届いたErr(内側のErr)は#[from]によりRecordError::InvalidDataに変換される
            let one_process = process?;
            let status = one_process.status.clone();
            if (status == TrainingJobStatus::Running) {
                let epoch = one_process.epoch;
                self.repository
                    .insert_epoch(job_id, epoch, &one_process)
                    .await
                    .map_err(|e| {
                        RecordError::RecordFailed(format!(
                            "Failed to record training process for job_id {}: {}",
                            job_id.as_str(),
                            e.to_string()
                        ))
                    })?;
            } else if (status == TrainingJobStatus::Stopped) {
                self.repository
                    .update_training_run(job_id, &status)
                    .await
                    .map_err(|e| {
                        RecordError::RecordFailed(format!(
                            "Failed to update training_run for job_id {}: {}",
                            job_id.as_str(),
                            e.to_string()
                        ))
                    })?;
            }
        }
        Ok(())
    }
}
