use entities::training::config::Loss as LossConfig;
use entities::training::config::Optimizer as OptimizerConfig;
use entities::training::config::TrainingConfig;
use entities::training::JobId;
use serde::{Deserialize, Serialize};

use crate::http::dto::training_mode::TrainingModeDto;

use super::data_spec::DataSpecDto;
use super::model::ModelGraphDto;

#[derive(Debug, Deserialize)]
pub struct StartTrainingRequestDto {
    pub mode: TrainingModeDto,
    #[serde(flatten)] // configの中身をjsonと同じにする
    pub config: TrainingConfigDto,
}

// TrainingConfig
#[derive(Debug, Deserialize)]
pub struct TrainingConfigDto {
    pub model_name: String,
    pub model_graph: ModelGraphDto,
    pub epoch: u32,
    pub batch: u32,
    pub device: String,
    pub dataset_path: String,
    pub optimizer: OptimizerConfigDto,
    pub loss: LossConfigDto,
    pub resume_from: Option<String>,
    pub seed: Option<u64>,
    pub data_spec: DataSpecDto,
    pub save_last_every: u32,
}

impl From<TrainingConfigDto> for TrainingConfig {
    fn from(value: TrainingConfigDto) -> Self {
        TrainingConfig {
            model_name: value.model_name,
            model_graph: value.model_graph.into(),
            epoch: value.epoch,
            batch: value.batch,
            device: value.device,
            dataset_path: value.dataset_path,
            optimizer: value.optimizer.into(),
            loss: value.loss.into(),
            resume_from: value.resume_from,
            seed: value.seed,
            data_spec: value.data_spec.into(),
            save_last_every: value.save_last_every,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct StartTrainingResponseDto {
    pub job_id: String,
}

impl From<JobId> for StartTrainingResponseDto {
    fn from(value: JobId) -> Self {
        StartTrainingResponseDto {
            job_id: value.as_str().to_string(),
        }
    }
}

// lossをドメインと同じ型にするためのドメイン再実装
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LossConfigDto {
    CrossEntropy,
    Mse,
    Dice,
    Focal { gamma: f64, alpha: f64 },
    // alpha は Cross Entropy 項の重み。(1 - alpha) が Dice 項の重み。
    Combo { alpha: f64 },
    Boundary,
}

impl From<LossConfigDto> for LossConfig {
    fn from(value: LossConfigDto) -> Self {
        match value {
            LossConfigDto::CrossEntropy => LossConfig::CrossEntropy,
            LossConfigDto::Mse => LossConfig::Mse,
            LossConfigDto::Dice => LossConfig::Dice,
            LossConfigDto::Focal { gamma, alpha } => LossConfig::Focal { gamma, alpha },
            LossConfigDto::Combo { alpha } => LossConfig::Combo { alpha },
            LossConfigDto::Boundary => LossConfig::Boundary,
        }
    }
}

// OptimizerConfigDto は、OptimizerConfig と同じ構造を持つが、serde でデシリアライズ可能な型。
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OptimizerConfigDto {
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

impl From<OptimizerConfigDto> for OptimizerConfig {
    fn from(value: OptimizerConfigDto) -> Self {
        match value {
            OptimizerConfigDto::Adam {
                learning_rate,
                weight_decay,
                beta1,
                beta2,
                eps,
            } => OptimizerConfig::Adam {
                learning_rate,
                weight_decay,
                beta1,
                beta2,
                eps,
            },
            OptimizerConfigDto::AdamW {
                learning_rate,
                weight_decay,
                beta1,
                beta2,
            } => OptimizerConfig::AdamW {
                learning_rate,
                weight_decay,
                beta1,
                beta2,
            },
            OptimizerConfigDto::Sgd {
                learning_rate,
                weight_decay,
                momentum,
                nesterov,
            } => OptimizerConfig::Sgd {
                learning_rate,
                weight_decay,
                momentum,
                nesterov,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use entities::model::layer::{ConcatSpec, Conv2DSpec, NodeSpec};
    use entities::training::config::{
        DataSpec, ImageAnnotationConfig, ImageSpec, ImageTaskSpec, PascalVocConfig,
        SegmentationSpec,
    };

    // GUI から届く想定の JSON が TrainingConfig まで変換できること
    #[test]
    fn json_converts_to_training_config() {
        let json = r#"{
            "model_name": "test_model",
            "model_graph": {
                "nodes": [
                    {
                        "id": "conv1",
                        "spec": { "type": "conv2d", "in_channels": 3, "out_channels": 16, "kernel_size": 3, "stride": 1, "padding": 1, "dilation": 1 },
                        "inputs": [{ "port": "x", "source": null }]
                    },
                    {
                        "id": "concat1",
                        "spec": { "type": "concat" },
                        "inputs": [{ "port": "x", "source": { "node_id": "conv1", "port": "y" } }]
                    }
                ],
                "outputs": [{ "node_id": "concat1", "port": "y" }]
            },
            "epoch": 1,
            "batch": 2,
            "device": "cpu",
            "dataset_path": "/data/VOCdevkit/VOC2012",
            "optimizer": { "type": "adam_w", "learning_rate": 0.001, "weight_decay": 0.0, "beta1": 0.9, "beta2": 0.999 },
            "loss": { "type": "focal", "gamma": 2.0, "alpha": 0.25 },
            "resume_from": null,
            "seed": 42,
            "data_spec": {
                "type": "image",
                "input_width": 256,
                "input_height": 256,
                "image_task_spec": { "type": "segmentation", "ignore_index": 255 },
                "image_annotation_config": { "type": "pascal_voc", "include_difficult": false }
            },
            "save_last_every": 0
        }"#;

        let dto: TrainingConfigDto = serde_json::from_str(json).unwrap();
        let config = TrainingConfig::from(dto);

        assert_eq!(
            config.model_graph.nodes[0].spec,
            NodeSpec::Conv2D(Conv2DSpec {
                in_channels: 3,
                out_channels: 16,
                kernel_size: 3,
                stride: 1,
                padding: 1,
                dilation: 1,
            })
        );
        assert_eq!(
            config.model_graph.nodes[1].spec,
            NodeSpec::Concat(ConcatSpec)
        );
        assert_eq!(
            config.optimizer,
            OptimizerConfig::AdamW {
                learning_rate: 0.001,
                weight_decay: 0.0,
                beta1: 0.9,
                beta2: 0.999,
            }
        );
        assert_eq!(
            config.loss,
            LossConfig::Focal {
                gamma: 2.0,
                alpha: 0.25,
            }
        );
        assert_eq!(
            config.data_spec,
            DataSpec::Image(ImageSpec {
                input_width: 256,
                input_height: 256,
                image_task_spec: ImageTaskSpec::Segmentation(SegmentationSpec {
                    ignore_index: 255,
                }),
                image_annotation_config: ImageAnnotationConfig::PascalVoc(PascalVocConfig {
                    include_difficult: false,
                }),
            })
        );
    }

    // 知らない種類はエラーになること
    #[test]
    fn unknown_optimizer_type_is_rejected() {
        let result = serde_json::from_str::<OptimizerConfigDto>(r#"{ "type": "rmsprop" }"#);
        assert!(result.is_err());
    }
}
