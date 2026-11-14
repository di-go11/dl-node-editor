use super::SqliteDatasetRepository;
use entities::dataset::{DatasetConfig, DatasetId};
use sqlx::Row;

use usecases::dataset::{error::DatasetError, ports::DatasetReader};

impl DatasetReader for SqliteDatasetRepository {
    async fn read(&self) -> Result<Vec<DatasetConfig>, DatasetError> {
        let rows = sqlx::query("SELECT * FROM datasets")
            .fetch_all(&self.pool)
            .await
            .map_err(|e| DatasetError::ReadFailed(e.to_string()))?;
        let datasets = rows
            .into_iter()
            .map(|row| {
                let id: String = row.get("dataset_id");
                Ok(DatasetConfig {
                    dataset_id: DatasetId::new(id)
                        .map_err(|e| DatasetError::ReadFailed(e.to_string()))?,
                    dataset_name: row.get("dataset_name"),
                    dataset_type: row.get("dataset_type"),
                    dataset_path: row.get("dataset_path"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                })
            })
            .collect::<Result<Vec<_>, DatasetError>>()?;
        Ok(datasets)
    }
}
