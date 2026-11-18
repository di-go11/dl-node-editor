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
    // アップロード時に指定された形式を知らない(クライアントの誤り)
    #[error("Unknown dataset format: {0}")]
    UnknownFormat(String),
    // 解凍した中身が、指定された形式に必要なファイル構成になっていない(クライアントの誤り)。
    // missing は足りないファイル・ディレクトリ(RequiredEntry::display_name の表記)
    #[error("Dataset does not match the {format} layout; missing: {}", missing.join(", "))]
    LayoutMismatch {
        format: String,
        missing: Vec<String>,
    },
}
