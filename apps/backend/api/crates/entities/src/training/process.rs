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
    // このエポックの最後のバッチで使った学習率(C++ が Optimizer から読んだ値)。
    // 1 エポックも終わっていない(epoch = 0)とき、学習率を送らない古い学習エンジンのときは None
    pub learning_rate: Option<f64>,
}
