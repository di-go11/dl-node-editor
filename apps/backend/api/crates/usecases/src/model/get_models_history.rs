use super::{
    error::ModelRepositoryError,
    ports::{ModelSummaryProvider, ModelTrainingConfigProvider},
};
use entities::model::{ModelId, ModelSummary, ModelTraingConfig};

// 学習済みモデルの一覧を取得する
#[derive(Debug, Clone)]
pub struct GetModelSummary<S> {
    summary: S,
}

impl<S> GetModelSummary<S>
where
    S: ModelSummaryProvider,
{
    pub fn new(summary_provider: S) -> Self {
        Self {
            summary: summary_provider,
        }
    }

    pub async fn get_summary(&self) -> Result<Vec<ModelSummary>, ModelRepositoryError> {
        Ok(self.summary.fetch().await?)
    }
}

// 学習済みモデルの最新の学習設定を取得する(再開フォームの初期値用)
#[derive(Debug, Clone)]
pub struct GetModelTrainingConfig<T> {
    config: T,
}

impl<T> GetModelTrainingConfig<T>
where
    T: ModelTrainingConfigProvider,
{
    pub fn new(config_provider: T) -> Self {
        Self {
            config: config_provider,
        }
    }

    pub async fn get_config(
        &self,
        model_id: &ModelId,
    ) -> Result<ModelTraingConfig, ModelRepositoryError> {
        Ok(self.config.fetch(model_id).await?)
    }
}
