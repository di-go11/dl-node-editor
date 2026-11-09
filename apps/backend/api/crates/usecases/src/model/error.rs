use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ModelRepositoryError {
    // FetchError
    #[error(transparent)]
    Fetch(#[from] FetchModelError),
}
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum FetchModelError {
    // クエリの実行に失敗した(DB に接続できないなど)
    #[error("invalid fetch query: {0}")]
    InvalidQuery(String),
    #[error("model not found: {0}")]
    NotFound(String),
    // DB の値を entity に戻せない(未知の optimizer_type、壊れた JSON など)
    #[error("stored model data is invalid: {0}")]
    InvalidData(String),
    // model.model_graph が NULL(0002 より前に作られたモデル)。再開できない
    #[error("model graph is not saved: {0}")]
    GraphNotSaved(String),
}
