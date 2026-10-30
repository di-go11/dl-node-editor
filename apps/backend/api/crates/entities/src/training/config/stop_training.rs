use super::super::job::JobId;

#[derive(Debug, PartialEq, Clone)]
pub struct StopTrainingConfig {
    pub job_id: JobId,
}