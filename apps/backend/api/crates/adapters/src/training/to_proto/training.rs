use crate::pb::training::v1::{self as training_pb};

use entities::training::config::TrainingConfig;
use entities::training::config::{Loss, Optimizer};
use entities::training::{JobId, ModelId};

use crate::pb::training::v1::optimizer_config::Config as OptimizerConfig;

use crate::pb::training::v1::loss_config::Config as LossConfig;

// StopTrainingRequestをJobIdから生成するためのトレイト実装
impl From<&JobId> for training_pb::StopTrainingRequest {
    fn from(value: &JobId) -> Self {
        training_pb::StopTrainingRequest {
            job_id: value.as_str().to_string(),
        }
    }
}

// TrainingConfig関連のドメインをprotoに変換するためのトレイト実装
impl From<&TrainingConfig> for training_pb::StartTrainingRequest {
    fn from(value: &TrainingConfig) -> Self {
        training_pb::StartTrainingRequest {
            model_name: value.model_name.clone(),
            model_graph: Some((&value.model_graph).into()),
            optimizer: Some((&value.optimizer).into()),
            loss: Some((&value.loss).into()),
            epoch: value.epoch,
            batch: value.batch,
            dataset_path: value.dataset_path.clone(),
            device: value.device.clone(),
            data_spec: Some((&value.data_spec).into()),
            save_last_every: value.save_last_every,
            // 新規学習では再開しないので空にする(proto 側は「空文字列なら再開しない」)。
            // 学習再開は proto の resume フラグと <model_id>_last.pt で行う予定のため、resume_from は使わない
            resume_from: String::new(),
            // proto 側は Seed で包んで「未指定」と 0 を区別するので、Some の中身だけ包む
            seed: value.seed.map(|v| training_pb::Seed { value: v }),
            model_id: String::new(),
            resume: false,
        }
    }
}

// Optimizer関連のドメインをprotoに変換するためのトレイト実装
impl From<&Optimizer> for training_pb::OptimizerConfig {
    fn from(value: &Optimizer) -> Self {
        match value {
            Optimizer::Adam {
                learning_rate,
                weight_decay,
                beta1,
                beta2,
                eps,
            } => training_pb::OptimizerConfig {
                config: Some(OptimizerConfig::Adam(training_pb::AdamConfig {
                    learning_rate: *learning_rate, // コピーするために*で参照外しをする。
                    weight_decay: *weight_decay,
                    beta1: *beta1,
                    beta2: *beta2,
                    eps: *eps,
                })),
            },
            Optimizer::AdamW {
                learning_rate,
                weight_decay,
                beta1,
                beta2,
            } => training_pb::OptimizerConfig {
                config: Some(OptimizerConfig::AdamW(training_pb::AdamWConfig {
                    learning_rate: *learning_rate,
                    weight_decay: *weight_decay,
                    beta1: *beta1,
                    beta2: *beta2,
                })),
            },
            Optimizer::Sgd {
                learning_rate,
                weight_decay,
                momentum,
                nesterov,
            } => training_pb::OptimizerConfig {
                config: Some(OptimizerConfig::Sgd(training_pb::SgdConfig {
                    learning_rate: *learning_rate,
                    weight_decay: *weight_decay,
                    momentum: *momentum,
                    nesterov: *nesterov,
                })),
            },
        }
    }
}

// Loss関連のドメインをprotoに変換するためのトレイト実装
impl From<&Loss> for training_pb::LossConfig {
    fn from(value: &Loss) -> Self {
        match value {
            Loss::CrossEntropy {} => training_pb::LossConfig {
                config: Some(LossConfig::CrossEntropy(training_pb::CrossEntropyConfig {})),
            },
            Loss::Mse {} => training_pb::LossConfig {
                config: Some(LossConfig::Mse(training_pb::MseLossConfig {})),
            },
            Loss::Dice {} => training_pb::LossConfig {
                config: Some(LossConfig::Dice(training_pb::DiceLossConfig {})),
            },
            Loss::Focal { gamma, alpha } => training_pb::LossConfig {
                config: Some(LossConfig::Focal(training_pb::FocalLossConfig {
                    gamma: *gamma,
                    alpha: *alpha,
                })),
            },
            Loss::Combo { alpha } => training_pb::LossConfig {
                config: Some(LossConfig::Combo(training_pb::ComboLossConfig {
                    alpha: *alpha,
                })),
            },
            Loss::Boundary {} => training_pb::LossConfig {
                config: Some(LossConfig::Boundary(training_pb::BoundaryLossConfig {})),
            },
        }
    }
}
