use super::{
    ModelSummaryProvider, ModelTrainingConfigProvider,
    error::{FetchModelError, ModelRepositoryError},
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
        self.summary
            .fetch()
            .await
            .map_err(|e| FetchModelError::InvalidQuery(e.to_string()))
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
