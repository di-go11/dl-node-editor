use super::error::FetchModelError;
use entities::{
    model::{ModelId, ModelSummary},
    training::config::TrainingConfig,
};

// 学習済みモデルの一覧を読み出す(training_runs が 1 件もないモデルは含めない)
pub trait ModelSummaryProvider {
    fn fetch(&self) -> impl Future<Output = Result<Vec<ModelSummary>, FetchModelError>> + Send;
}

// モデルの最新の run の学習設定を読み出す
pub trait ModelTrainingConfigProvider {
    fn fetch(
        &self,
        model_id: &ModelId,
    ) -> impl Future<Output = Result<TrainingConfig, FetchModelError>> + Send;
}
