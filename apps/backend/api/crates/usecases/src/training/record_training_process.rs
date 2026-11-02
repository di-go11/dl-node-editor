use super::TrainingProcessProviderError;
use super::{RecordError, RepositoryError};
use entities::training::JobId;
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

pub trait TrainingRecordRepository {
    fn insert_run(
        &self,
        job_id: &JobId,
        config: &TrainingConfig,
    ) -> impl Future<Output = Result<(), RepositoryError>> + Send;

    fn last_saved_epoch(
        &self,
        job_id: &JobId,
    ) -> impl Future<Output = Result<u32, RepositoryError>> + Send;
    fn insert_epoch(
        &self,
        job_id: &JobId,
        epoch: u32,
        process: &TrainingProcess,
    ) -> impl Future<Output = Result<(), RepositoryError>> + Send;
    fn finish_run(
        &self,
        job_id: &JobId,
        status: &TrainingJobStatus,
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

impl<P: TrainingEpochProvider, R: TrainingRecordRepository> RecordTrainingProgress<P, R> {
    pub async fn execute(&self, job_id: &JobId) -> Result<(), RecordError> {
        // すでに保存されているepochについて調べる。
        let after_epoch = self
            .repository
            .last_saved_epoch(job_id)
            .await
            .map_err(|e| RecordError::LastSavedEpochFailed(e.to_string()))?;
        let mut stream = self
            .provider
            .stream_epoch_after(job_id, after_epoch)
            .await?;

        // 届いたらDBに保存するだけの処理
        while let Some(process) = stream.next().await {
            
        }
        Ok(())
    }
}
