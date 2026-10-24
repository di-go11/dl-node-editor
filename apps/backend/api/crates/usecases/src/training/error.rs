use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum OrderError {
    // C++サーバーに対して学習プロセスを開始するための命令を送る関数が失敗した場合のエラー
    #[error("Start training order failed: {0}")]
    StartOrderFailed(String),
    // protoの変換に失敗した場合のエラー
    #[error("Failed to convert to proto: {0}")]
    ConversionToProtoFailed(String),
}
