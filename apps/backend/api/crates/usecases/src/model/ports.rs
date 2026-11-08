use super::error::FetchModelError;
use entities::{
    model::{ModelId, ModelSummary, ModelTraingConfig},
    training::config::TrainingConfig,
};
pub trait ModelSummaryProvider {
    fn fetch(&self) -> impl Future<Output = Result<Vec<ModelSummary>, FetchModelError>> + Send;
}

pub trait ModelTrainingConfigProvider {
    fn fetch(
        &self,
        model_id: &ModelId,
    ) -> impl Future<Output = Result<TrainingConfig, FetchModelError>> + Send;
}
