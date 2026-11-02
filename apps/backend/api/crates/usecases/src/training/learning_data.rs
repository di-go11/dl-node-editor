use super::RepositoryError;
use super::TrainingProcessProviderError;
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

pub struct RecordTrainingProgress<P, R> {
    provider: P,
    repository: R,
}

impl <P:TrainingEpochProvider, R: TrainingRecordRepository> RecordTrainingProgress<P,R> {
    pub async fn execute(&self, job_id: &JobId) -> Result<(), RecordError>{
        
    }

}