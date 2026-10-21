use std::time::Duration;

use super::{Metrics, TrainingJobStatus};
#[derive(Debug, PartialEq, Clone)]
pub struct TrainingProcess {
    pub epoch: u32,
    pub train_loss: f64,
    pub val_loss: f64,
    pub status: TrainingJobStatus,
    pub metrics: Option<Metrics>,
    pub epoch_elapsed_time: Duration,
    pub total_elapsed_time: Duration,
}
