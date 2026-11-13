use super::TrainingStopper;
use super::error::StopTrainingError;
use entities::training::JobId;
use entities::training::TrainingJobStatus;

pub struct StopTraining<S: TrainingStopper> {
    stopper: S,
}

impl<S: TrainingStopper> StopTraining<S> {
    pub fn new(stopper: S) -> Self {
        Self { stopper }
    }
    pub async fn execute(&self, job_id: &JobId) -> Result<TrainingJobStatus, StopTrainingError> {
        self.stopper.stop_training(job_id).await
    }
}
