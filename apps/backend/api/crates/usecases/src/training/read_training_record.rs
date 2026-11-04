use entities::training::JobId;
use entities::training::ModelId;

use super::{RecordError, StreamError, TrainingProgressProviderError};
use entities::training::TrainingProcess;
use futures_core::Stream;
use futures_util::Future;
pub trait TrainingRecordReader {
    //モデルnameからJobIDを見つける
    fn find_model_id_by_name(
        &self,
        model_name: &str,
    ) -> impl Future<Output = Result<Option<ModelId>, RecordError>> + Send;
    // 最後に.ptを保存したエポック数を取り出す
    fn last_saved_epoch(
        &self,
        job_id: &JobId,
    ) -> impl Future<Output = Result<u32, RecordError>> + Send;
    // 学習中のジョブIDを取り出す。
    fn find_running_job_ids(&self) -> impl Future<Output = Result<Vec<JobId>, RecordError>> + Send;
}

// DBから保存済みのEpoch数を確認するトレイト
pub trait TrainingStreamRecorder {
    type EpochStream: Stream<Item = Result<TrainingProcess, TrainingProgressProviderError>> + Send;
    fn stream_epoch_after(
        &self,
        job_id: &JobId,
        after_epoch: u32,
    ) -> impl Future<Output = Result<Self::EpochStream, StreamError>> + Send;
}
