use super::SqliteDatasetRepository;
use entities::dataset::{DatasetConfig, DatasetId};
use sqlx::Row;
use usecases::dataset::{error::DatasetError, ports::DatasetFinder};

impl DatasetFinder for SqliteDatasetRepository {
    async fn find(&self, dataset_id: &DatasetId) -> Result<Option<DatasetConfig>, DatasetError> {
        let row = sqlx::query(
            "SELECT dataset_id, dataset_name, dataset_type, dataset_path, created_at, updated_at \
             FROM datasets WHERE dataset_id = ?",
        )
        .bind(dataset_id.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DatasetError::ReadFailed(e.to_string()))?;

        // 見つからないのは異常ではないので None を返す(学習開始のユースケースが DatasetNotFound にする)
        let Some(row) = row else {
            return Ok(None);
        };
        Ok(Some(DatasetConfig {
            dataset_id: dataset_id.clone(),
            dataset_name: row.get("dataset_name"),
            dataset_type: row.get("dataset_type"),
            dataset_path: row.get("dataset_path"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::SqliteDatasetRepository;
    use entities::dataset::DatasetId;
    use sqlx::sqlite::SqlitePoolOptions;
    use usecases::dataset::ports::{DatasetFinder, DatasetRegister, RegisterDatasetInput};

    // インメモリ DB は接続ごとに別物になるため、接続を 1 本に絞る
    async fn setup_test_db() -> SqliteDatasetRepository {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./src/migrations").run(&pool).await.unwrap();
        SqliteDatasetRepository::new(pool)
    }

    #[tokio::test]
    async fn finds_registered_dataset_by_id() {
        let repo = setup_test_db().await;
        repo.register(&RegisterDatasetInput {
            dataset_id: DatasetId::new("dataset-1").unwrap(),
            dataset_name: "voc2012".to_string(),
            dataset_type: "pascal_voc".to_string(),
            dataset_path: "/datasets/dataset-1".to_string(),
        })
        .await
        .unwrap();

        let found = repo
            .find(&DatasetId::new("dataset-1").unwrap())
            .await
            .unwrap()
            .expect("registered dataset should be found");

        assert_eq!(found.dataset_id.as_str(), "dataset-1");
        assert_eq!(found.dataset_name, "voc2012");
        assert_eq!(found.dataset_path, "/datasets/dataset-1");
        assert_eq!(found.updated_at, None);
    }

    #[tokio::test]
    async fn returns_none_for_unknown_id() {
        let repo = setup_test_db().await;

        let found = repo
            .find(&DatasetId::new("missing").unwrap())
            .await
            .unwrap();

        assert_eq!(found, None);
    }
}
