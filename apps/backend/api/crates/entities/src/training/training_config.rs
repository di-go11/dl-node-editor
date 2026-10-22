// まだ、値の範囲チェックを入れていないため必要なものはstructで抽象を作った後,implの実装のコンストラクタでバリデーションを行う.

// training_config
#[derive(Debug, PartialEq, Clone)]
pub struct TrainingConfig {
    pub epoch: u64,
    pub batch: u64,
    pub device: String,
    pub detaset_path: String,
    pub optimizer: Optimizer,
    pub loss: Loss,
    pub resume_from: Option<String>,
    pub seed: Option<u64>,
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
