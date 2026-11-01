use entities::training::TrainingJobStatus;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TrainingJobStatusDto {
    Idle,
    Running,
    Completed,
    Failed { reason: String },
    Stopped,
}

impl From<TrainingJobStatus> for TrainingJobStatusDto {
    fn from(status: TrainingJobStatus) -> Self {
        match status {
            TrainingJobStatus::Idle => TrainingJobStatusDto::Idle,
            TrainingJobStatus::Running => TrainingJobStatusDto::Running,
            TrainingJobStatus::Completed => TrainingJobStatusDto::Completed,
            TrainingJobStatus::Failed { reason } => TrainingJobStatusDto::Failed { reason },
            TrainingJobStatus::Stopped => TrainingJobStatusDto::Stopped,
        }
    }
}
