use super::SqliteDatasetRepository;
use entities::dataset::Dataset;
use tonic::Code::Ok;
use usecases::dataset::{error::DatasetError, ports::DatasetReader};

impl DatasetReader for SqliteDatasetRepository {
    async fn read(&self) -> Result<Vec<Dataset>, DatasetError> {
        let rows = sqlx::query("SELECT * FROM datasets")
            .fetch_all(self.pool)
            .await
            .map_err(|e| DatasetError::ReadFailed(e.to_string()))?;
        let datasets = rows
            .into_iter()
            .map(|row| Dataset {
                dataset_id: row.get("dataset_id"),
                dataset_name: row.get("dataset_name"),
                dataset_type: row.get("dataset_type"),
                dataset_path: row.get("dataset_path"),
                created_at: row.get("created_at"),
                updated_at: row.get("updated_at"),
            })
            .collect();
        Ok(datasets)
    }
}
