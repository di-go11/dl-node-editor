use super::error::FetchModelError;
use entities::{
    model::{ModelHistory, ModelId, ModelSummary},
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

// モデルの学習の記録(全 run のエポックごとの結果)を読み出す
pub trait ModelHistoryProvider {
    fn fetch_history(
        &self,
        model_id: &ModelId,
    ) -> impl Future<Output = Result<ModelHistory, FetchModelError>> + Send;
}
