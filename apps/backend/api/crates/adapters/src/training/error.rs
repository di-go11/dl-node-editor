use thiserror::Error;

#[derive(Debug, PartialEq, Eq, Error)]
pub enum TrainingConversionError {
    #[error("process status is unspecified")]
    UnspecifiedJobStatusType,
    #[error("unknown status type: {0}")] // 0(Unspecified), 1~5(Idle, Running, Completed, Failed, Stopped)以外の値が代入された時。
    UnknownTrainingStatus(i32),
}
