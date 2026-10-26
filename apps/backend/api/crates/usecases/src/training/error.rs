use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum StartTrainingError {
    // C++サーバーに対して学習プロセスを開始するための命令を送る関数が失敗した場合のエラー
    #[error("Start training order failed: {0}")]
    StartOrderFailed(String),
    // protoの変換に失敗した場合のエラー
    #[error("Failed to convert to proto: {0}")]
    ConversionToProtoFailed(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]

pub enum StopTrainingError {
    // C++サーバーに対して学習プロセスを停止するための命令を送る関数が失敗した場合のエラー
    #[error("Stop training order failed: {0}")]
    StopOrderFailed(String),
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
