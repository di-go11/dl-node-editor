use entities::model::ModelId;
use entities::training::JobId;

use super::RecordError;
use futures_util::Future;
pub trait TrainingRecordReader {
    //モデルnameからJobIDを見つける
    fn find_model_id_by_name(
        &self,
        model_name: &str,
    ) -> impl Future<Output = Result<Option<ModelId>, RecordError>> + Send;
    // 最後にDBに保存されたエポックを返す。(再開用)
    fn last_saved_epoch(
        &self,
        job_id: &JobId,
    ) -> impl Future<Output = Result<u32, RecordError>> + Send;
    // 学習中のジョブIDを取り出す。
    fn find_running_job_ids(&self) -> impl Future<Output = Result<Vec<JobId>, RecordError>> + Send;
    // TODO: TrainingModelIDごとの.pt保存時のエポック数をだす処理も実装する。
}
