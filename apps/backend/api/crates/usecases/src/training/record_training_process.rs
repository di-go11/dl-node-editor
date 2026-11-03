use super::TrainingProcessProviderError;
use super::RepositoryError;
use entities::training::{JobId, ModelId};
use entities::training::TrainingJobStatus;
use entities::training::TrainingProcess;
use entities::training::config::TrainingConfig;
use futures_core::Stream;

pub trait TrainingEpochProvider {
    type EpochStream: Stream<Item = Result<TrainingProcess, TrainingProcessProviderError>> + Send;
    fn stream_epoch_after(
        &self,
        job_id: &JobId,
        after_epoch: u32,
    ) -> impl Future<Output = Result<Self::EpochStream, TrainingProcessProviderError>> + Send;
}
pub trait TrainingRunRegistar {
    //学習開始時同じモデルグラフ名があると.ptを上書きしてしまうため。名前検索を行い存在しているか確認.存在する場合はmodel_idで返す。
    // TODO: SELECT処理なのでGetトレイトを作るときに実装する。
    // fn ensure_model(
    //     &self,
    //     model_name: &str,
    // ) -> impl Future<Output = Result<ModelId, RepositoryError>> + Send;
    // 新しいモデルをmodelテーブルにinsertする処理。training_runsが外部キーで参照するため先に呼ぶ。
    fn insert_model(
        &self,
        model_id: &ModelId,
        model_name: &str,
    ) -> impl Future<Output = Result<(), RepositoryError>> + Send;
    // 学習開始時の情報をtraining_runテーブルのinsertする処理。
    fn insert_training_run(
        &self,
        job_id: &JobId,
        config: &TrainingConfig,
        model_id: &ModelId,
    ) -> impl Future<Output = Result<(), RepositoryError>> + Send;
    fn update_training_run(
        &self,
        job_id: &JobId,
        status: &TrainingJobStatus
    ) -> impl Future<Output = Result<(),RepositoryError>> + Send;
}
pub trait TrainingResultRegister {
    fn insert_epoch(
        &self,
        job_id: &JobId,
        epoch: u32,
        process: &TrainingProcess,
    ) -> impl Future<Output = Result<(), RepositoryError>> + Send;
}

// 2つのユースケースをまとめて1つにする
// 一つは,gRPCからストリームを受け取るユースケース
// もう一つは,受け取ったストリームをDBに保存するユースケース
// これらのユースケースを一つのトレイトとして実装すると責務が大きくなるため、2つに分けそれをユースケース内のimplでまとめる。
pub struct RecordTrainingProgress<P, R> {
    provider: P,
    repository: R,
}

// TODO: last_saved_epochを持つGetトレイトを作るまでコメントアウト。
// use futures_util::StreamExt;
// use std::pin::pin;
// impl<P: TrainingEpochProvider, R: TrainingRecordRepository> RecordTrainingProgress<P, R> {
//     pub async fn execute(
//         &self,
//         job_id: &JobId,
//         config: &TrainingConfig,
//     ) -> Result<(), RecordError> {
//         // すでに保存されているepochについて調べる。
//         let after_epoch = self
//             .repository
//             .last_saved_epoch(job_id)
//             .await
//             .map_err(|e| RecordError::LastSavedEpochFailed(e.to_string()))?;
//
//         let mut stream = self
//             .provider
//             .stream_epoch_after(job_id, after_epoch)
//             .await?;
//         let mut stream = pin!(stream); // StreamExt::next()はSelf:Upin（StreamExtフィールド内としてコンポジットしている)で固定する決まり。pin!()で値ムーブをこのスコープないだけで禁止にする。
//
//         // 届いたらDBに保存するだけの処理
//         while let Some(process) = stream.next().await {
//             let process = process?;
//             let epoch = process.;
//             self.repository.insert_epoch(job_id, epoch, process).await?;
//         }
//
//         // 学習が終了していればDB::trainig_runsのUpdate
//         Ok(())
//     }
// }
