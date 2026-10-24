// Rust内ドメインをprotoに変換するためのトレイト

use entities::training::config::{
    DataSpec, ImageAnnotationConfig, ImageSpec, ImageTaskSpec, Loss, Optimizer, PascalVocConfig,
};
use usecases::training::OrderError::ConversionToProtoFailed;

use crate::pb::model::v1 as pb;
use crate::pb::training::v1::data_spec::Spec as PbDataSpec;
use crate::pb::training::v1::image_annotation_config::Config as PbImageAnnotationConfig;
use crate::pb::training::v1::image_task_specs as PbImageTaskSpecs;
use crate::pb::training::v1::loss_config::Config as LossConfig;
use crate::pb::training::v1::optimizer_config::Config as OptimizerConfig;
use crate::pb::training::v1::ClassificationSpec as PbClassificationSpec;
use crate::pb::training::v1::SegmentationSpec as PbSegmentationSpec;
use crate::pb::training::v1::{self as training_pb};

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

// Data関連のドメインをprotoに変換するためのトレイト実装
impl From<&DataSpec> for training_pb::DataSpec {
    fn from(value: &DataSpec) -> Self {
        match value {
            DataSpec::Image(ImageSpec {
                input_height,
                input_width,
                image_task_spec,
                image_annotation_config,
            }) => training_pb::DataSpec {
                spec: Some(PbDataSpec::Image(training_pb::ImageSpec {
                    annotation: Some(image_annotation_config.into()),
                    input_height: *input_height,
                    input_width: *input_width,
                    task_specs: Some(image_task_spec.into()),
                })),
            },
        }
    }
}

impl From<&ImageAnnotationConfig> for training_pb::ImageAnnotationConfig {
    fn from(value: &ImageAnnotationConfig) -> Self {
        match value {
            ImageAnnotationConfig::PascalVoc(PascalVocConfig { include_difficult }) => Self {
                config: Some(PbImageAnnotationConfig::PascalVoc(
                    training_pb::PascalVocConfig {
                        include_difficult: *include_difficult,
                    },
                )),
            },
        }
    }
}

impl From<&ImageTaskSpec> for training_pb::ImageTaskSpecs {
    fn from(value: &ImageTaskSpec) -> Self {
        let spec = match value {
            ImageTaskSpec::Classification {} => {
                training_pb::image_task_specs::Spec::Classification(
                    training_pb::ClassificationSpec {},
                )
            }
            ImageTaskSpec::Segmentation(segmentation_spec) => {
                training_pb::image_task_specs::Spec::Segmentation(training_pb::SegmentationSpec {
                    ignore_index: segmentation_spec.ignore_index,
                })
            }
        };
        Self { spec: Some(spec) }
    }
}
