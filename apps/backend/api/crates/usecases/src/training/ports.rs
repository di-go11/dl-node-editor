use std::future::Future;

use entities::training::TrainingProcess;
use thiserror::Error;

//

pub trait TrainingProcessProvider {
    fn fetch(
        &self,
    ) -> impl Future<Output = Result<TrainingProcess, TrainingProcessProviderError>> + Send;
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]

pub enum TrainingProcessProviderError {
    // 通信できなかった(C++のサーバーが起動していない. タイムアウトなど)
    #[error("training-process-provider is unavailable: {0}")]
    Unavailable(String),
    // 返ってきたデータが不正
    #[error("training-process-provider returned invalid data: {0}")]
    InvalidData(String),
}
