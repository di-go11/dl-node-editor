use std::future::Future;

use entities::Capabilities;
use thiserror::Error;

/// ユースケースが外部に求める機能
/// 実装はadaptersに置く
pub trait CapabilityProvider {
    fn fetch(&self) -> impl Future<Output = Result<Capabilities, ProviderError>> + Send;
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ProviderError {
    /// 通信できなかった(C++のサーバーが起動していない、タイムアウトなど)
    #[error("capability provider is unavailable: {0}")]
    Unavailable(String),
    // 返ってきたデータが不正
    #[error("capability provider returned invalid data: {0}")]
    InvalidData(String),
}
