use entities::training::{JobId, ModelId};
use usecases::training::{RecordError, RepositoryError, TrainingRecordReader};

use super::SqliteTrainingRepository;

// DBから学習記録を読み出す処理。OK/NGの判定はせず、見つかったかどうかだけを返す
impl TrainingRecordReader for SqliteTrainingRepository {
    async fn find_model_id_by_name(
        &self,
        model_name: &str,
    ) -> Result<Option<ModelId>, RecordError> {
        // 0件ならNone(model_nameはUNIQUEなので最大1件)
        let raw: Option<String> =
            sqlx::query_scalar::<_, String>("SELECT model_id FROM model WHERE model_name = ?")
                .bind(model_name)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| RepositoryError::QueryFailed(e.to_string()))?;
        let model_id: Option<ModelId> = raw
            .map(ModelId::new)
            .transpose()
            .map_err(|e| RepositoryError::InvalidData(e.to_string()))?;
        Ok(model_id)
    }
    async fn last_saved_epoch(&self, job_id: &JobId) -> Result<u32, RecordError> {
        let finished_epoch = sqlx::query_scalar::<_, u32>(
            "SELECT COALESCE(MAX(epoch),0) FROM training_epochs WHERE job_id = ?",
        )
        .bind(job_id.as_str())
        .fetch_one(&self.pool)
        .await
        .map_err(|e| RepositoryError::QueryFailed(e.to_string()))?;
        // 該当するjob_idのrowがない場合未学習として0を返す。
        Ok(finished_epoch)
    }
    async fn find_running_job_ids(&self) -> Result<Vec<JobId>, usecases::training::RecordError> {
        let raws = sqlx::query_scalar::<_, String>(
            "SELECT job_id FROM training_runs WHERE status = 'running' ",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| RepositoryError::QueryFailed(e.to_string()))?;
        let mut ids = Vec::with_capacity(raws.len());
        for raw in raws {
            let id = JobId::new(raw).map_err(|e| RepositoryError::InvalidData(e.to_string()))?;
            ids.push(id);
        }
        Ok(ids)
    }
}
