use std::process::Output;

use super::error::FetchModelError;
use entities::{
    model::{ModelId, ModelSummar, ModelTraingConfig},
    training::config::TrainingConfig,
};
pub trait ModelSummaryProvider {
    fn fetch(&self) -> impl Future<Output = Result<ModelSummary, FetchModelError>> + Send;
}

pub trait ModelTrainingConfigProvider {
    fn fetch(
        &self,
        model_id: &ModelId,
    ) -> impl Future<Output = Result<TrainingConfig, FetchModelError>> + Send;
}
