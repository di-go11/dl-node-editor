use crate::training::RecordError;
use crate::training::TrainingProgressProvider;
use crate::training::TrainingRecordReader;

use entities::training::TrainingJobStatus;
use entities::training::TrainingProcess;
use entities::training::config::TrainingConfig;
use entities::training::{JobId, ModelId};
use futures_util::StreamExt; // stream.next()を使うための拡張トレイト
use std::pin::pin;

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
pub struct RecordTrainingProgress<P, R> {
    provider: P,
    repository: R,
}

// 保存済みエポック数を確認して現在まで送られてきたエポックデータを保存。

impl<
    P: TrainingProgressProvider,
    R: TrainingProgressRecorder + TrainingRecordReader + TrainingRunRegistar,
> RecordTrainingProgress<P, R>
{
    pub fn new(provider: P, repository: R) -> Self {
        Self {
            provider,
            repository,
        }
    }
    pub async fn execute(&self, job_id: &JobId) -> Result<(), RecordError> {
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
            if status == TrainingJobStatus::Running {
                let epoch = one_process.epoch;
                self.repository
                    .insert_epoch(job_id, epoch, &one_process)
                    .await
                    .map_err(|e| {
                        RecordError::RecordFailed(format!(
                            "Failed to record training process for job_id {}: {}",
                            job_id.as_str(),
                            e
                        ))
                    })?;
            } else if status.is_finished() {
                self.repository
                    .update_training_run(job_id, &status)
                    .await
                    .map_err(|e| {
                        RecordError::RecordFailed(format!(
                            "Failed to update training_run for job_id {}: {}",
                            job_id.as_str(),
                            e
                        ))
                    })?;
                return Ok(());
            }
        }
        Err(RecordError::StreamEnded(job_id.as_str().to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::training::TrainingProgressProviderError;
    use std::sync::Mutex;
    use std::time::Duration;

    type Item = Result<TrainingProcess, TrainingProgressProviderError>;

    fn job_id() -> JobId {
        JobId::new("job-1").unwrap()
    }

    // 途中のエポック(RUNNING)
    fn running(epoch: u32) -> TrainingProcess {
        TrainingProcess {
            epoch,
            train_loss: 0.5,
            val_loss: 0.6,
            status: TrainingJobStatus::Running,
            metrics: None,
            epoch_elapsed_time: Duration::from_secs(1),
            total_elapsed_time: Duration::from_secs(u64::from(epoch)),
        }
    }

    // C++が全エポックの後に1回だけ送る終了メッセージ(epochは0、メトリクスなし)
    fn finished(status: TrainingJobStatus) -> TrainingProcess {
        TrainingProcess {
            epoch: 0,
            train_loss: 0.0,
            val_loss: 0.0,
            status,
            metrics: None,
            epoch_elapsed_time: Duration::ZERO,
            total_elapsed_time: Duration::ZERO,
        }
    }

    // stream_epoch_afterで、あらかじめ決めたStreamを返す偽Provider。渡されたafter_epochを記録する
    struct FakeProvider {
        result: Result<Vec<Item>, TrainingProgressProviderError>,
        requested_after_epoch: Mutex<Option<u32>>,
    }
    impl TrainingProgressProvider for FakeProvider {
        type ProgressStream = futures_util::stream::Iter<std::vec::IntoIter<Item>>;
        async fn stream_progress(
            &self,
            _job_id: &JobId,
        ) -> Result<Self::ProgressStream, TrainingProgressProviderError> {
            unimplemented!("RecordTrainingProgress does not call stream_progress")
        }
        type EpochStream = futures_util::stream::Iter<std::vec::IntoIter<Item>>;
        async fn stream_epoch_after(
            &self,
            _job_id: &JobId,
            after_epoch: u32,
        ) -> Result<Self::EpochStream, TrainingProgressProviderError> {
            *self.requested_after_epoch.lock().unwrap() = Some(after_epoch);
            self.result.clone().map(futures_util::stream::iter)
        }
    }

    // 保存されたエポックと更新されたstatusを記録する偽Repository
    struct FakeRepository {
        last_saved_epoch_result: Result<u32, RecordError>,
        insert_epoch_result: Result<(), RecordError>,
        inserted_epochs: Mutex<Vec<u32>>,
        updated_statuses: Mutex<Vec<TrainingJobStatus>>,
    }
    impl TrainingRecordReader for FakeRepository {
        async fn find_model_id_by_name(
            &self,
            _model_name: &str,
        ) -> Result<Option<ModelId>, RecordError> {
            unimplemented!("RecordTrainingProgress does not call find_model_id_by_name")
        }
        async fn last_saved_epoch(&self, _job_id: &JobId) -> Result<u32, RecordError> {
            self.last_saved_epoch_result.clone()
        }
        async fn find_running_job_ids(&self) -> Result<Vec<JobId>, RecordError> {
            unimplemented!("RecordTrainingProgress does not call find_running_job_ids")
        }
    }
    impl TrainingProgressRecorder for FakeRepository {
        async fn insert_epoch(
            &self,
            _job_id: &JobId,
            epoch: u32,
            _process: &TrainingProcess,
        ) -> Result<(), RecordError> {
            self.inserted_epochs.lock().unwrap().push(epoch);
            self.insert_epoch_result.clone()
        }
    }
    impl TrainingRunRegistar for FakeRepository {
        async fn insert_model(
            &self,
            _model_id: &ModelId,
            _model_name: &str,
        ) -> Result<(), RecordError> {
            unimplemented!("RecordTrainingProgress does not call insert_model")
        }
        async fn insert_training_run(
            &self,
            _job_id: &JobId,
            _config: &TrainingConfig,
            _model_id: &ModelId,
        ) -> Result<(), RecordError> {
            unimplemented!("RecordTrainingProgress does not call insert_training_run")
        }
        async fn update_training_run(
            &self,
            _job_id: &JobId,
            status: &TrainingJobStatus,
        ) -> Result<(), RecordError> {
            self.updated_statuses.lock().unwrap().push(status.clone());
            Ok(())
        }
    }

    fn gen_usecase(
        last_saved_epoch_result: Result<u32, RecordError>,
        stream_result: Result<Vec<Item>, TrainingProgressProviderError>,
    ) -> RecordTrainingProgress<FakeProvider, FakeRepository> {
        RecordTrainingProgress::new(
            FakeProvider {
                result: stream_result,
                requested_after_epoch: Mutex::new(None),
            },
            FakeRepository {
                last_saved_epoch_result,
                insert_epoch_result: Ok(()),
                inserted_epochs: Mutex::new(vec![]),
                updated_statuses: Mutex::new(vec![]),
            },
        )
    }

    // usecaseを実行した後、Fakeに記録された内容を取り出す
    fn inserted_epochs(usecase: &RecordTrainingProgress<FakeProvider, FakeRepository>) -> Vec<u32> {
        usecase.repository.inserted_epochs.lock().unwrap().clone()
    }
    fn updated_statuses(
        usecase: &RecordTrainingProgress<FakeProvider, FakeRepository>,
    ) -> Vec<TrainingJobStatus> {
        usecase.repository.updated_statuses.lock().unwrap().clone()
    }

    #[tokio::test]
    async fn records_running_epochs_and_updates_run_when_completed() {
        let usecase = gen_usecase(
            Ok(0),
            Ok(vec![
                Ok(running(1)),
                Ok(running(2)),
                Ok(finished(TrainingJobStatus::Completed)),
            ]),
        );

        let result = usecase.execute(&job_id()).await;

        assert_eq!(result, Ok(()));
        // 終了メッセージ(epoch 0)はinsert_epochに渡さない
        assert_eq!(inserted_epochs(&usecase), vec![1, 2]);
        assert_eq!(
            updated_statuses(&usecase),
            vec![TrainingJobStatus::Completed]
        );
    }

    #[tokio::test]
    async fn passes_failed_status_with_reason_to_update() {
        let failed = TrainingJobStatus::Failed {
            reason: "CUDA out of memory".to_string(),
        };
        let usecase = gen_usecase(
            Ok(0),
            Ok(vec![Ok(running(1)), Ok(finished(failed.clone()))]),
        );

        let result = usecase.execute(&job_id()).await;

        assert_eq!(result, Ok(()));
        assert_eq!(updated_statuses(&usecase), vec![failed]);
    }

    #[tokio::test]
    async fn requests_epochs_after_last_saved_epoch() {
        let usecase = gen_usecase(
            Ok(3),
            Ok(vec![
                Ok(running(4)),
                Ok(finished(TrainingJobStatus::Stopped)),
            ]),
        );

        let result = usecase.execute(&job_id()).await;

        assert_eq!(result, Ok(()));
        // DBに保存済みのエポックの続きから受け取る
        assert_eq!(
            *usecase.provider.requested_after_epoch.lock().unwrap(),
            Some(3)
        );
        assert_eq!(inserted_epochs(&usecase), vec![4]);
        assert_eq!(updated_statuses(&usecase), vec![TrainingJobStatus::Stopped]);
    }

    #[tokio::test]
    async fn returns_stream_ended_when_stream_closes_before_finish_message() {
        let usecase = gen_usecase(Ok(0), Ok(vec![Ok(running(1))]));

        let result = usecase.execute(&job_id()).await;

        assert_eq!(
            result,
            Err(RecordError::StreamEnded(job_id().as_str().to_string()))
        );
        assert_eq!(inserted_epochs(&usecase), vec![1]);
        // 終了していないのでtraining_runsは更新しない
        assert_eq!(updated_statuses(&usecase), vec![]);
    }

    #[tokio::test]
    async fn returns_stream_open_failed_when_stream_cannot_be_opened() {
        let not_found = TrainingProgressProviderError::NotFound("job-1".to_string());
        let usecase = gen_usecase(Ok(0), Err(not_found.clone()));

        let result = usecase.execute(&job_id()).await;

        assert_eq!(result, Err(RecordError::StreamOpenFailed(not_found)));
        assert_eq!(inserted_epochs(&usecase), vec![]);
        assert_eq!(updated_statuses(&usecase), vec![]);
    }

    #[tokio::test]
    async fn stops_when_error_arrives_in_the_middle_of_stream() {
        let unavailable = TrainingProgressProviderError::Unavailable("disconnected".to_string());
        let usecase = gen_usecase(
            Ok(0),
            Ok(vec![
                Ok(running(1)),
                Err(unavailable.clone()),
                Ok(running(2)),
            ]),
        );

        let result = usecase.execute(&job_id()).await;

        assert_eq!(
            result,
            Err(RecordError::InvalidProgressProvidedData(unavailable))
        );
        // エラー以降のエポックは保存しない
        assert_eq!(inserted_epochs(&usecase), vec![1]);
        assert_eq!(updated_statuses(&usecase), vec![]);
    }

    #[tokio::test]
    async fn returns_last_saved_epoch_failed_without_opening_stream() {
        let usecase = gen_usecase(
            Err(RecordError::RecordFailed("db locked".to_string())),
            Ok(vec![]),
        );

        let result = usecase.execute(&job_id()).await;

        assert!(matches!(result, Err(RecordError::LastSavedEpochFailed(_))));
        assert_eq!(
            *usecase.provider.requested_after_epoch.lock().unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn stops_when_insert_epoch_fails() {
        let mut usecase = gen_usecase(
            Ok(0),
            Ok(vec![
                Ok(running(1)),
                Ok(running(2)),
                Ok(finished(TrainingJobStatus::Completed)),
            ]),
        );
        usecase.repository.insert_epoch_result =
            Err(RecordError::RecordFailed("disk full".to_string()));

        let result = usecase.execute(&job_id()).await;

        assert!(matches!(result, Err(RecordError::RecordFailed(_))));
        // 最初の保存で失敗したら、それ以降は保存も更新もしない
        assert_eq!(inserted_epochs(&usecase), vec![1]);
        assert_eq!(updated_statuses(&usecase), vec![]);
    }
}
