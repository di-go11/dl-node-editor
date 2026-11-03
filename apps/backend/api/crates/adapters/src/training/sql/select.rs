use entities::training::ModelId;
use usecases::training::{RepositoryError, TrainingRecordReader};

use crate::training::SqliteTrainingRepository;

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
