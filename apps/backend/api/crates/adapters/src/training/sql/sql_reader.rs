use entities::training::{JobId, ModelId};
use usecases::training::{RepositoryError, TrainingProgressReader, TrainingRecordReader};

use super::SqliteTrainingRepository;

// DBから学習記録を読み出す処理。OK/NGの判定はせず、見つかったかどうかだけを返す
impl TrainingRecordReader for SqliteTrainingRepository {
    async fn find_model_id_by_name(
        &self,
        model_name: &str,
    ) -> Result<Option<ModelId>, RepositoryError> {
        // 0件ならNone(model_nameはUNIQUEなので最大1件)
        let model_id =
            sqlx::query_scalar::<_, String>("SELECT model_id FROM model WHERE model_name = ?")
                .bind(model_name)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| RepositoryError::QueryFailed(e.to_string()))?;
        model_id
            .map(ModelId::new)
            .transpose()
            .map_err(|e| RepositoryError::InvalidData(e.to_string()))
    }
}

impl TrainingProgressReader for SqliteTrainingRepository {
    async fn last_saved_epoch(&self, job_id: &JobId) -> Result<u32, RepositoryError> {
        let epoch = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(MAX(epoch),0) FROM training_epochs WHERE job_id = ?",
        )
        .bind(job_id.as_str())
        .fetch_one(&self.pool)
        .await
        .map_err(|e| RepositoryError::QueryFailed(e.to_string()))?;
        u32::try_from(epoch).map_err(|e| RepositoryError::InvalidData(e.to_string()))
    }
    async fn find_running_job_ids(&self) -> Result<Vec<JobId>, RepositoryError> {
        let ids: Vec<JobID> =
            sqlx::query_scalar("SELECT job_id FROM training_runs WHERE status = 'running'")
                .fetch_all(&self.pool)
                .await
                .map_err(|e| RepositoryError::QueryFailed(e.to_string()))?;
        ids.into_iter()
            .map(JobId::new)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| RepositoryError::InvalidData(e.to_string()))
    }
}
