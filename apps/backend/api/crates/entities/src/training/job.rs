use thiserror::Error;

#[derive(Debug, PartialEq, Eq, Error)]
pub enum JobIdError {
    #[error("job id must not be empty")]
    Empty,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct JobId(String);

impl JobId {
    pub fn new(value: impl Into<String>) -> Result<Self, JobIdError> {
        let value = value.into(); // valueの型推論みたいな感じ。
        if value.is_empty() {
            return Err(JobIdError::Empty);
        }
        Ok(Self(value))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrainingJobStatus {
    Idle,
    Running,
    Completed,
    Failed { reason: String },
    Stopped,
}

impl TrainingJobStatus {
    pub fn is_finished(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed { .. } | Self::Stopped)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_job_id_is_rejected() {
        let result = JobId::new("");
        assert!(matches!(result, Err(JobIdError::Empty)));
    }

    #[test]
    fn non_empty_job_id_is_accepted() {
        let result = JobId::new("1");
        assert!(result.is_ok());
    }

    #[test]
    fn only_completed_failed_stopped_are_finished() {
        assert!(TrainingJobStatus::Completed.is_finished());
        assert!(TrainingJobStatus::Failed {
            reason: "error".to_string()
        }
        .is_finished());
        assert!(TrainingJobStatus::Stopped.is_finished());
        assert!(!TrainingJobStatus::Idle.is_finished());
        assert!(!TrainingJobStatus::Running.is_finished());
    }
}
