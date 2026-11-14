use super::sql_dataset_repository::SqliteDatasetRepository;
use usecases::dataset::ports::{DatasetRegister, RegisterDatasetInput};

impl DatasetRegister for SqliteDatasetRepository {
    async fn register(
        &self,
        dataset: &RegisterDatasetInput,
    ) -> Result<(), usecases::dataset::error::DatasetError> {
        sqlx::query("INSERT INTO datasets (dataset_id, dataset_name, dataset_type, dataset_path, created_at) VALUES (?, ?, ?, ?, ?)")
            .bind(&dataset.dataset_id)
            .bind(&dataset.dataset_name)
            .bind(&dataset.dataset_type)
            .bind(&dataset.dataset_path)
            .bind(chrono::Utc::now().to_rfc3339())
            .execute(&self.pool)
            .await
            .map_err(|e| usecases::dataset::error::DatasetError::DatabaseError(e.to_string()))?;
        Ok(())
    }
}
