use super::sql_dataset_repository::SqliteDatasetRepository;
use usecases::dataset::error::DatasetError;
use usecases::dataset::ports::{DatasetRegister, RegisterDatasetInput};

impl DatasetRegister for SqliteDatasetRepository {
    async fn register(
        &self,
        dataset: &RegisterDatasetInput,
    ) -> Result<(), usecases::dataset::error::DatasetError> {
        sqlx::query("INSERT INTO datasets (dataset_id, dataset_name, dataset_type, dataset_path, created_at) VALUES (?, ?, ?, ?, ?)")
            .bind(dataset.dataset_id.as_str())
            .bind(&dataset.dataset_name)
            .bind(&dataset.dataset_type)
            .bind(&dataset.dataset_path)
            .bind(chrono::Utc::now().to_rfc3339())
            .execute(&self.pool)
            .await
            .map_err(|e| DatasetError::RegisterFailed(e.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::SqliteDatasetRepository;
    use entities::dataset::DatasetId;
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::Row;
    use std::assert_eq;
    use usecases::dataset::ports::DatasetRegister;
    use usecases::dataset::ports::RegisterDatasetInput;

    // インメモリのSQLiteデータベースをセットアップするためのヘルパー関数
    async fn setup_test_db() -> SqliteDatasetRepository {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        // datasets テーブルを作るためにマイグレーションを流す(学習側のテストと同じ)
        sqlx::migrate!("./src/migrations").run(&pool).await.unwrap();
        SqliteDatasetRepository::new(pool)
    }

    fn sample_dataset() -> RegisterDatasetInput {
        RegisterDatasetInput {
            dataset_id: DatasetId::new("TestId".to_string()).unwrap(),
            dataset_name: "Test Dataset".to_string(),
            dataset_type: "Test Type".to_string(),
            dataset_path: "/path/to/dataset".to_string(),
        }
    }

    // データベースにデータセットに関するメタデータを登録するテスト
    #[tokio::test]
    async fn insert_dataset_success() {
        let repo = setup_test_db().await;
        let dataset = sample_dataset();

        // データセットを登録
        repo.register(&dataset).await.expect("failed to connect");

        let query_result = sqlx::query("SELECT * FROM datasets")
            .fetch_all(&repo.pool)
            .await
            .expect("query error");
        // データベースに登録されたデータが正しいことを確認
        assert_eq!(query_result.len(), 1);
        let row = &query_result[0];
        assert_eq!(
            row.get::<String, &str>("dataset_id"),
            dataset.dataset_id.as_str()
        );
        assert_eq!(
            row.get::<String, &str>("dataset_name"),
            dataset.dataset_name
        );
        assert_eq!(
            row.get::<String, &str>("dataset_type"),
            dataset.dataset_type
        );
        assert_eq!(
            row.get::<String, &str>("dataset_path"),
            dataset.dataset_path
        );
    }
}
