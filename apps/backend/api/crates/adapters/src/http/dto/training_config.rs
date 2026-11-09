use entities::training::config::Loss as LossConfig;
use entities::training::config::Optimizer as OptimizerConfig;
use entities::training::config::TrainingConfig;
use entities::training::JobId;
use serde::{Deserialize, Serialize};

use super::data_spec::DataSpecDto;
use super::model::ModelGraphDto;

// TrainingConfig。次の 3 つで共有する(リクエストとレスポンスで JSON の形が同じになる)
// - 新規学習の開始・整合性チェックのリクエスト
// - GET /models/{model_id}/config のレスポンス(ResumeTrainingConfigDto の中身)
// - POST /models/{model_id}/resume のリクエスト(同上)
#[derive(Debug, Serialize, Deserialize)]
pub struct TrainingConfigDto {
    pub model_name: String,
    pub model_graph: ModelGraphDto,
    pub epoch: u32,
    pub batch: u32,
    pub device: String,
    pub dataset_path: String,
    pub optimizer: OptimizerConfigDto,
    pub loss: LossConfigDto,
    pub seed: Option<u64>,
    pub data_spec: DataSpecDto,
    pub save_last_every: u32,
}

// Dto->entity
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
            seed: value.seed,
            data_spec: value.data_spec.into(),
            save_last_every: value.save_last_every,
        }
    }
}

// entity->Dto
impl From<TrainingConfig> for TrainingConfigDto {
    fn from(value: TrainingConfig) -> Self {
        TrainingConfigDto {
            model_name: value.model_name,
            model_graph: value.model_graph.into(),
            epoch: value.epoch,
            batch: value.batch,
            device: value.device,
            dataset_path: value.dataset_path,
            optimizer: value.optimizer.into(),
            loss: value.loss.into(),
            seed: value.seed,
            data_spec: value.data_spec.into(),
            save_last_every: value.save_last_every,
        }
    }
}

// 学習再開用の設定。GET /models/{model_id}/config の応答をそのまま POST /models/{model_id}/resume に送り返せる。
// flatten なので JSON は { "model_id": ..., "model_name": ..., "epoch": ..., ... } とフラットになる。
// TODO: 固定項目(model_name / model_graph / data_spec / Optimizer の種類)は、今はフロントで読み取り専用にしているだけ。
//       バックエンドでの上書き・照合は issue doc 作業5 を参照。
#[derive(Debug, Serialize, Deserialize)]
pub struct ResumeTrainingConfigDto {
    pub model_id: String,
    #[serde(flatten)]
    pub config: TrainingConfigDto,
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
#[derive(Debug, Serialize, Deserialize)]
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
#[derive(Debug, Serialize, Deserialize)]
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

// entity->Dto
impl From<LossConfig> for LossConfigDto {
    fn from(value: LossConfig) -> Self {
        match value {
            LossConfig::CrossEntropy => LossConfigDto::CrossEntropy,
            LossConfig::Mse => LossConfigDto::Mse,
            LossConfig::Dice => LossConfigDto::Dice,
            LossConfig::Focal { gamma, alpha } => LossConfigDto::Focal { gamma, alpha },
            LossConfig::Combo { alpha } => LossConfigDto::Combo { alpha },
            LossConfig::Boundary => LossConfigDto::Boundary,
        }
    }
}

impl From<OptimizerConfig> for OptimizerConfigDto {
    fn from(value: OptimizerConfig) -> Self {
        match value {
            OptimizerConfig::Adam {
                learning_rate,
                weight_decay,
                beta1,
                beta2,
                eps,
            } => OptimizerConfigDto::Adam {
                learning_rate,
                weight_decay,
                beta1,
                beta2,
                eps,
            },
            OptimizerConfig::AdamW {
                learning_rate,
                weight_decay,
                beta1,
                beta2,
            } => OptimizerConfigDto::AdamW {
                learning_rate,
                weight_decay,
                beta1,
                beta2,
            },
            OptimizerConfig::Sgd {
                learning_rate,
                weight_decay,
                momentum,
                nesterov,
            } => OptimizerConfigDto::Sgd {
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
    use entities::model::{ModelGraph, Node, NodeInput, PortRef};

    // entity -> DTO -> JSON -> DTO -> entity で元に戻ること(取得した設定をそのまま再開に送り返せる)
    #[test]
    fn training_config_round_trips_through_json() {
        let config = TrainingConfig {
            model_name: "test_model".to_string(),
            model_graph: ModelGraph {
                nodes: vec![
                    Node {
                        id: "conv1".to_string(),
                        spec: NodeSpec::Conv2D(Conv2DSpec {
                            in_channels: 3,
                            out_channels: 16,
                            kernel_size: 3,
                            stride: 1,
                            padding: 1,
                            dilation: 1,
                        }),
                        inputs: vec![NodeInput {
                            port: "x".to_string(),
                            source: None,
                        }],
                    },
                    Node {
                        id: "concat1".to_string(),
                        spec: NodeSpec::Concat(ConcatSpec),
                        inputs: vec![NodeInput {
                            port: "x".to_string(),
                            source: Some(PortRef {
                                node_id: "conv1".to_string(),
                                port: "y".to_string(),
                            }),
                        }],
                    },
                ],
                outputs: vec![PortRef {
                    node_id: "concat1".to_string(),
                    port: "y".to_string(),
                }],
            },
            epoch: 3,
            batch: 2,
            device: "cpu".to_string(),
            dataset_path: "/data/VOCdevkit/VOC2012".to_string(),
            optimizer: OptimizerConfig::Sgd {
                learning_rate: 0.01,
                weight_decay: 1e-4,
                momentum: 0.9,
                nesterov: true,
            },
            loss: LossConfig::Focal {
                gamma: 2.0,
                alpha: 0.25,
            },
            seed: None,
            data_spec: DataSpec::Image(ImageSpec {
                input_width: 256,
                input_height: 256,
                image_task_spec: ImageTaskSpec::Classification,
                image_annotation_config: ImageAnnotationConfig::PascalVoc(PascalVocConfig {
                    include_difficult: true,
                }),
            }),
            save_last_every: 1,
        };

        let json = serde_json::to_string(&TrainingConfigDto::from(config.clone())).unwrap();
        let dto: TrainingConfigDto = serde_json::from_str(&json).unwrap();

        assert_eq!(TrainingConfig::from(dto), config);
    }

    // ResumeTrainingConfigDto は model_id と設定が同じ階層に並ぶこと(flatten)
    #[test]
    fn resume_config_is_flat_json() {
        let json = serde_json::json!({
            "model_id": "model-1",
            "model_name": "test_model",
            "model_graph": { "nodes": [], "outputs": [] },
            "epoch": 10,
            "batch": 2,
            "device": "cpu",
            "dataset_path": "/data",
            "optimizer": { "type": "adam", "learning_rate": 0.001, "weight_decay": 0.0, "beta1": 0.9, "beta2": 0.999, "eps": 1e-8 },
            "loss": { "type": "cross_entropy" },
            "seed": null,
            "data_spec": {
                "type": "image",
                "input_width": 256,
                "input_height": 256,
                "image_task_spec": { "type": "classification" },
                "image_annotation_config": { "type": "pascal_voc", "include_difficult": false }
            },
            "save_last_every": 1
        });

        let dto: ResumeTrainingConfigDto = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(dto.model_id, "model-1");
        assert_eq!(dto.config.epoch, 10);
        // 送り返すときも同じ形になる
        assert_eq!(serde_json::to_value(&dto).unwrap(), json);
    }
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
