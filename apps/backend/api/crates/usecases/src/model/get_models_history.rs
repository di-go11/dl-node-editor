use super::{
    error::{FetchModelError, ModelRepositoryError},
    ports::{ModelSummaryProvider, ModelTrainingConfigProvider},
};
use entities::model::{ModelId, ModelSummary, ModelTraingConfig};

#[derive(Debug, Clone)]
pub struct GetTrainingHistory<S, T> {
    summary: S,
    model_training_config: T,
}

impl<S, T> GetTrainingHistory<S, T>
where
    S: ModelSummaryProvider,
    T: ModelTrainingConfigProvider,
{
    pub fn new(summary_provider: S, config_provider: T) -> Self {
        Self {
            summary: summary_provider,
            model_training_config: config_provider,
        }
    }

    pub async fn get_summary(&self) -> Result<Vec<ModelSummary>, ModelRepositoryError> {
        Ok(self.summary.fetch().await?)
    }

    pub async fn get_config(
        &self,
        model_id: &ModelId,
    ) -> Result<ModelTraingConfig, ModelRepositoryError> {
        self.model_training_config
            .fetch(model_id)
            .await
            .map_err(|e| FetchModelError::NotFound(e.to_string()))
    }
}

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
        self.summary
            .fetch()
            .await
            .map_err(|e| FetchModelError::InvalidQuery(e.to_string()))
    }
}

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
        self.config
            .fetch(model_id)
            .await
            .map_err(|e| FetchModelError::NotFound(e.to_string()))
    }
}
