use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ModelRepositoryError {
    // FetchError
    #[error(transparent)]
    Fetch(#[from] FetchModelError),
}
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum FetchModelError {
    // 呼び出しクエリが不正
    #[error("invalid fetch query: {0}")]
    InvalidQuery(String),
    #[error("model not found: {0}")]
    NotFound(String),
}
