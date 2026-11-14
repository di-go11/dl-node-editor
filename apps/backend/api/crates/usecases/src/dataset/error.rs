use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum DatasetError {
    // データセットのメタデータ登録に失敗した場合のエラー
    #[error("Failed to register dataset metadata: {0}")]
    RegisterFailed(String),
    // データセットの保存に失敗した場合のエラー
    #[error("Failed to save dataset: {0}")]
    SaveFailed(String),
    // データセットの呼び出しに失敗した場合のエラー
    #[error("Failed to call dataset: {0}")]
    CallFailed(String),
    // データセットの読み込みに失敗した場合のエラー
    #[error("Failed to read dataset: {0}")]
    ReadFailed(String),
}
