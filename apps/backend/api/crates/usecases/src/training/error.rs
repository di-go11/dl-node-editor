use std::error;

use thiserror::Error;

use crate::capabilities::ProviderError;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum StartTrainingError {
    // C++サーバーに対して学習プロセスを開始するための命令を送る関数が失敗した場合のエラー
    #[error("Start training order failed: {0}")]
    StartOrderFailed(String),
    // protoの変換に失敗した場合のエラー
    #[error("Failed to convert to proto: {0}")]
    ConversionToProtoFailed(String),
    // すでに実行中のジョブがある
    #[error("Training job is already running: {0}")]
    AlreadyRunning(String),
    // 学習設定が不正でC++サーバーからの拒否
    #[error("Training config was rejected: {0}")]
    InvalidConfig(String),
    #[error("Failed to record training run: {0}")]
    RecordFailed(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]

pub enum StopTrainingError {
    // C++サーバーに対して学習プロセスを停止するための命令を送る関数が失敗した場合のエラー
    #[error("Stop training order failed: {0}")]
    StopOrderFailed(String),
    // C++サーバーから返ってきたレスポンスが不正だった場合のエラー
    #[error("Stop training returned invalid response: {0}")]
    InvalidResponse(String),
    // 指定されたジョブが存在しない
    #[error("training job was not found: {0}")]
    NotFound(String),
}
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum StreamError {
    // Streamの読み込みに失敗
    #[error("Failed read stream: {0}")]
    FailedReadStream(String),
}
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum TrainingProgressProviderError {
    // 通信できなかった(C++のサーバーが起動していない. タイムアウトなど)
    #[error("training-process-provider is unavailable: {0}")]
    Unavailable(String),
    // 指定されたジョブが存在しない
    #[error("training job was not found: {0}")]
    NotFound(String),
    // 返ってきたデータが不正
    #[error("training-process-provider returned invalid data: {0}")]
    InvalidData(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum RepositoryError {
    // データベースの接続に失敗した場合のエラー
    #[error("Database connection failed: {0}")]
    ConnectionFailed(String),
    // データベースのクエリが失敗した場合のエラー
    #[error("Database query failed: {0}")]
    QueryFailed(String),
    // データベースのトランザクションが失敗した場合のエラー
    #[error("Database transaction failed: {0}")]
    TransactionFailed(String),
    // データベースのデータが不正だった場合のエラー
    #[error("Database returned invalid data: {0}")]
    InvalidData(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum RecordError {
    // 何らかの理由で保存に失敗した場合のエラー
    #[error("Failed to record training process: {0}")]
    RecordFailed(String),
    // すでに保存されたepochを取り出す際のエラー
    #[error("Failed to retrieve last saved epoch: {0}")]
    LastSavedEpochFailed(String),
    // C++からの学習プロセスの渡しに失敗したときにRecordでもエラーとしてだすためのエラー
    #[error("Failed to record training process by failing provider error: {0}")]
    ProviderError(ProviderError),
    // 終了メッセージ前にストリームが閉じた
    #[error("Stream finished before getting finish message: {0}")]
    StreamEnded(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ValidateTrainingConfigError {
    #[error("model name is already used: {0}")]
    ModelNameAlreadyUsed(String),
    #[error("failed to read training record: {0}")]
    ReadFailed(String),
}
