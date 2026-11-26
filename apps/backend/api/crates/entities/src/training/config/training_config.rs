use crate::model::ModelGraph;

use super::data_spec::DataSpec;
// まだ、値の範囲チェックを入れていないため必要なものはstructで抽象を作った後,implの実装のコンストラクタでバリデーションを行う.

// training_config
#[derive(Debug, PartialEq, Clone)]
pub struct TrainingConfig {
    pub model_name: String,
    pub model_graph: ModelGraph,
    pub epoch: u32,
    pub batch: u32,
    pub device: String,
    pub dataset_path: String,
    pub optimizer: Optimizer,
    pub loss: Loss,
    pub seed: Option<u64>,
    pub data_spec: DataSpec,
    pub save_last_every: u32,
    pub lr_scheduler: LearningRateScheduler,
}

// Optimizer
// 並び順・パラメータは training.proto の OptimizerConfig と対応させる。
#[derive(Debug, PartialEq, Clone)]
pub enum Optimizer {
    Adam {
        learning_rate: f64,
        weight_decay: f64,
        beta1: f64,
        beta2: f64,
        eps: f64,
    },
    AdamW {
        learning_rate: f64,
        weight_decay: f64,
        beta1: f64,
        beta2: f64,
    },
    Sgd {
        learning_rate: f64,
        weight_decay: f64,
        momentum: f64,
        nesterov: bool,
    },
}

// LrScheduler
#[derive(Debug, PartialEq, Clone)]
pub struct LearningRateScheduler {
    pub scheduler: LearningRateSchedulerConfig,
    pub update_interval: LearningRateUpdateInterval,
    pub warmup_epochs: u32,
}
#[derive(Debug, PartialEq, Clone)]
pub enum LearningRateSchedulerConfig {
    None,
    Poly { power: f64 },
    Cosine { min_lr: f64 },
    Step { step_size: u32, gamma: f64 },
}

#[derive(Debug, PartialEq, Clone)]

pub enum LearningRateUpdateInterval {
    PerBatch,
    PerEpoch,
}
// Loss
// 並び順は training.proto の LossConfig(C++ の LossType)と対応させる。
#[derive(Debug, PartialEq, Clone)]
pub enum Loss {
    CrossEntropy,
    Mse,
    Dice,
    Focal { gamma: f64, alpha: f64 },
    // alpha は Cross Entropy 項の重み。(1 - alpha) が Dice 項の重み。
    Combo { alpha: f64 },
    Boundary,
}
