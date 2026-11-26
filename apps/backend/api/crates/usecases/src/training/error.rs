use thiserror::Error;

use crate::capabilities::ProviderError;

use entities::validation::ConfigViolation;

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
    // C++ が設定を INVALID_ARGUMENT で拒否した。設定の誤りは Rust の検証で先に返すので、
    // これが起きるのは Rust の検証漏れ(バグ)。クライアントの誤りではない
    #[error("Training config was rejected: {0}")]
    EngineRejectedConfig(String),
    #[error("Failed to record training run: {0}")]
    RecordFailed(String),
    // エポック数が達していたり、checkpointが存在しないなどで学習を実行できない
    #[error("Failed to resume training: {0}")]
    ResumePreconditionFailed(String),
    // 指定された dataset_id のデータセットが登録されていない(削除済み・ID の誤りなど)
    #[error("dataset not found: {0}")]
    DatasetNotFound(String),
    // データセットの情報を DB から読めなかった
    #[error("Failed to read dataset: {0}")]
    DatasetReadFailed(String),
    // 学習設定が不正
    #[error("invalid config: {} violation(s)", .0.len())]
    InvalidConfig(Vec<ConfigViolation>),
}

// 学習再開(ResumeTraining)のエラー
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ResumeTrainingError {
    // 指定された model_id のモデル(または学習の記録)がない
    #[error("model not found: {0}")]
    ModelNotFound(String),
    // model_graph が保存されていないなど、再開に必要な情報がない
    #[error("model is not resumable: {0}")]
    NotResumable(String),
    // DB からの読み出しに失敗した
    #[error("failed to read model: {0}")]
    ReadFailed(String),
    // Optimizer の種類が前回と違う(種類を変えると checkpoint の optimizer 状態を引き継げない)
    #[error("optimizer type changed: {0}")]
    OptimizerTypeChanged(String),
    // C++ での学習開始・記録の失敗。AlreadyRunning / ResumePreconditionFailed などは新規学習と同じ扱い
    #[error(transparent)]
    Start(#[from] StartTrainingError),
    // 学習設定が不正
    #[error("invalid config: {} violation(s)", .0.len())]
    InvalidConfig(Vec<ConfigViolation>),
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
    // C++とのストリームを開けなかった(ジョブが存在しない・サーバーに繋がらないなど)
    // InvalidDataと同じ型を持つため#[from]は付けられない。map_errで明示的に変換する
    #[error("Failed to open epoch stream: {0}")]
    StreamOpenFailed(TrainingProgressProviderError),
    // c++からの不正データ取り出しによるエラー
    #[error("Invalid data received from training process provider: {0}")]
    InvalidProgressProvidedData(#[from] TrainingProgressProviderError),
    // 不正データ書き込みによるエラー
    #[error("Invalid data received: {0}")]
    InvalidData(String),
    // リポジトリ操作のミスによるエラー
    #[error("Failed to operate repository: {0}")]
    FailedOperateRepository(#[from] RepositoryError),
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ValidateTrainingConfigError {
    #[error("model name is already used: {0}")]
    ModelNameAlreadyUsed(String),
    #[error("failed to read training record: {0}")]
    ReadFailed(String),
    // 設定の値が不正(違反をすべて持つ)
    #[error("invalid config: {} violation(s)", .0.len())]
    InvalidConfig(Vec<ConfigViolation>),
}
