use entities::training::JobId;
use entities::training::ModelId;

use crate::training::RepositoryError;

pub trait TrainingRecordReader {
    fn find_model_id_by_name(
        &self,
        model_name: &str,
    ) -> impl Future<Output = Result<Option<ModelId>, RepositoryError>> + Send;
}

// 進捗の状態の読み取り
pub trait TrainingProgressReader {
    // 最後に.ptを保存したエポック数を取り出す
    fn last_saved_epoch(&self, job_id: &JobId) -> Result<u32, RepositoryError>;
    // 学習中のジョブIDを取り出す。
    fn find_running_job_ids(&self) -> Result<Vec<JobId>, RepositoryError>;
}

impl 