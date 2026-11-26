use entities::dataset::{DatasetId, DatasetIdError};
use entities::training::config::Loss as LossConfig;
use entities::training::config::Optimizer as OptimizerConfig;
use entities::training::config::TrainingConfig;
use entities::training::config::{
    LearningRateScheduler, LearningRateSchedulerConfig, LearningRateUpdateInterval,
};
use entities::training::JobId;
use serde::{Deserialize, Serialize};
use usecases::training::{ResumeTrainingConfig, StartTrainingConfig};

use super::data_spec::DataSpecDto;
use super::model::ModelGraphDto;

// 新規学習の開始・整合性チェックのリクエスト。
// データセットは登録済みの ID で指定する。サーバー上のパスは受け取らない(StartTraining が ID から引く)。
#[derive(Debug, Deserialize)]
pub struct TrainingConfigDto {
    pub model_name: String,
    pub model_graph: ModelGraphDto,
    pub epoch: u32,
    pub batch: u32,
    pub device: String,
    pub dataset_id: String,
    pub optimizer: OptimizerConfigDto,
    pub loss: LossConfigDto,
    pub seed: Option<u64>,
    pub data_spec: DataSpecDto,
    pub save_last_every: u32,
    // 任意。省略したら none(スケジューラなし。学習率は optimizer の値のまま。古いクライアントもそのまま動く)
    pub lr_scheduler: Option<LearningRateSchedulerDto>,
}

// Dto->ユースケースの入力。dataset_id が空ならエラー(ハンドラが 422 にする)
impl TryFrom<TrainingConfigDto> for StartTrainingConfig {
    type Error = DatasetIdError;

    fn try_from(value: TrainingConfigDto) -> Result<Self, Self::Error> {
        Ok(StartTrainingConfig {
            model_name: value.model_name,
            model_graph: value.model_graph.into(),
            epoch: value.epoch,
            batch: value.batch,
            device: value.device,
            dataset_id: DatasetId::new(value.dataset_id)?,
            optimizer: value.optimizer.into(),
            loss: value.loss.into(),
            seed: value.seed,
            data_spec: value.data_spec.into(),
            save_last_every: value.save_last_every,
            lr_scheduler: value
                .lr_scheduler
                .map_or_else(LearningRateScheduler::none, Into::into),
        })
    }
}

// 保存済みの学習設定のレスポンス(ModelTrainingConfigDto の中身)。
// サーバー上のデータセットのパスは返さない(クライアントにパスを見せない)。
#[derive(Debug, Serialize)]
pub struct SavedTrainingConfigDto {
    pub model_name: String,
    pub model_graph: ModelGraphDto,
    pub epoch: u32,
    pub batch: u32,
    pub device: String,
    pub optimizer: OptimizerConfigDto,
    pub loss: LossConfigDto,
    pub seed: Option<u64>,
    pub data_spec: DataSpecDto,
    pub save_last_every: u32,
    // 再開では変えられない(保存した設定で再開する)。画面に表示するために返す
    pub lr_scheduler: LearningRateSchedulerDto,
}

// entity->Dto(dataset_path はここで落とす)
impl From<TrainingConfig> for SavedTrainingConfigDto {
    fn from(value: TrainingConfig) -> Self {
        SavedTrainingConfigDto {
            model_name: value.model_name,
            model_graph: value.model_graph.into(),
            epoch: value.epoch,
            batch: value.batch,
            device: value.device,
            optimizer: value.optimizer.into(),
            loss: value.loss.into(),
            seed: value.seed,
            data_spec: value.data_spec.into(),
            save_last_every: value.save_last_every,
            lr_scheduler: value.lr_scheduler.into(),
        }
    }
}

// GET /models/{model_id}/config のレスポンス。再開フォームの初期値と、固定項目の表示に使う。
// flatten なので JSON は { "model_id": ..., "model_name": ..., "epoch": ..., ... } とフラットになる。
#[derive(Debug, Serialize)]
pub struct ModelTrainingConfigDto {
    pub model_id: String,
    #[serde(flatten)]
    pub config: SavedTrainingConfigDto,
}

// POST /models/{model_id}/resume のリクエスト。再開時に変えてよい項目だけを持つ。
// 固定項目(model_name / model_graph / data_spec / seed / データセット)は受け取らず、ResumeTraining が DB の前回設定から使う。
// 再開するモデルはパスの model_id で決めるので、本体には持たせない。
// 以前のクライアントが dataset_path を送ってきても、知らないキーとして無視される(serde の既定の動作)。
#[derive(Debug, Deserialize)]
pub struct ResumeTrainingConfigDto {
    pub epoch: u32,
    pub batch: u32,
    pub device: String,
    pub optimizer: OptimizerConfigDto,
    pub loss: LossConfigDto,
    pub save_last_every: u32,
}

impl From<ResumeTrainingConfigDto> for ResumeTrainingConfig {
    fn from(value: ResumeTrainingConfigDto) -> Self {
        ResumeTrainingConfig {
            epoch: value.epoch,
            batch: value.batch,
            device: value.device,
            optimizer: value.optimizer.into(),
            loss: value.loss.into(),
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

// 学習率スケジューラ。種類を "type" に入れ、パラメータを直下に並べる(optimizer と同じ書き方)。
// 例: { "type": "poly", "power": 0.9, "update_interval": "per_batch", "warmup_epochs": 1 }
// 基準の学習率は optimizer の learning_rate(スケジューラ側には持たない)。
// 違反の位置(lr_scheduler.power など)は、この JSON の項目名と同じ。
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct LearningRateSchedulerDto {
    #[serde(flatten)]
    pub scheduler: LearningRateSchedulerConfigDto,
    pub update_interval: LearningRateUpdateIntervalDto,
    pub warmup_epochs: u32,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LearningRateSchedulerConfigDto {
    None,
    Poly { power: f64 },
    Cosine { min_lr: f64 },
    // step_size はエポック数
    Step { step_size: u32, gamma: f64 },
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LearningRateUpdateIntervalDto {
    PerBatch,
    PerEpoch,
}

impl From<LearningRateSchedulerDto> for LearningRateScheduler {
    fn from(value: LearningRateSchedulerDto) -> Self {
        LearningRateScheduler {
            scheduler: match value.scheduler {
                LearningRateSchedulerConfigDto::None => LearningRateSchedulerConfig::None,
                LearningRateSchedulerConfigDto::Poly { power } => {
                    LearningRateSchedulerConfig::Poly { power }
                }
                LearningRateSchedulerConfigDto::Cosine { min_lr } => {
                    LearningRateSchedulerConfig::Cosine { min_lr }
                }
                LearningRateSchedulerConfigDto::Step { step_size, gamma } => {
                    LearningRateSchedulerConfig::Step { step_size, gamma }
                }
            },
            update_interval: match value.update_interval {
                LearningRateUpdateIntervalDto::PerBatch => LearningRateUpdateInterval::PerBatch,
                LearningRateUpdateIntervalDto::PerEpoch => LearningRateUpdateInterval::PerEpoch,
            },
            warmup_epochs: value.warmup_epochs,
        }
    }
}

impl From<LearningRateScheduler> for LearningRateSchedulerDto {
    fn from(value: LearningRateScheduler) -> Self {
        LearningRateSchedulerDto {
            scheduler: match value.scheduler {
                LearningRateSchedulerConfig::None => LearningRateSchedulerConfigDto::None,
                LearningRateSchedulerConfig::Poly { power } => {
                    LearningRateSchedulerConfigDto::Poly { power }
                }
                LearningRateSchedulerConfig::Cosine { min_lr } => {
                    LearningRateSchedulerConfigDto::Cosine { min_lr }
                }
                LearningRateSchedulerConfig::Step { step_size, gamma } => {
                    LearningRateSchedulerConfigDto::Step { step_size, gamma }
                }
            },
            update_interval: match value.update_interval {
                LearningRateUpdateInterval::PerBatch => LearningRateUpdateIntervalDto::PerBatch,
                LearningRateUpdateInterval::PerEpoch => LearningRateUpdateIntervalDto::PerEpoch,
            },
            warmup_epochs: value.warmup_epochs,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::data_spec::{ImageAnnotationConfigDto, ImageTaskSpecDto};
    use super::*;
    use entities::model::layer::{ConcatSpec, Conv2DSpec, NodeSpec};
    use entities::model::{ModelGraph, Node, NodeInput, PortRef};
    use entities::training::config::{
        DataSpec, ImageAnnotationConfig, ImageSpec, ImageTaskSpec, PascalVocConfig, RgbColor,
        SegmentationSpec,
    };

    fn gen_saved_config() -> TrainingConfig {
        TrainingConfig {
            lr_scheduler: entities::training::config::LearningRateScheduler::none(),
            model_name: "test_model".to_string(),
            model_graph: ModelGraph {
                nodes: vec![],
                outputs: vec![],
            },
            epoch: 10,
            batch: 2,
            device: "cpu".to_string(),
            dataset_path: "/datasets/dataset-1".to_string(),
            optimizer: OptimizerConfig::Adam {
                learning_rate: 0.001,
                weight_decay: 0.0,
                beta1: 0.9,
                beta2: 0.999,
                eps: 1e-8,
            },
            loss: LossConfig::CrossEntropy,
            seed: None,
            data_spec: DataSpec::Image(ImageSpec {
                input_width: 256,
                input_height: 256,
                image_task_spec: ImageTaskSpec::Classification,
                image_annotation_config: ImageAnnotationConfig::PascalVoc(PascalVocConfig {
                    include_difficult: false,
                }),
            }),
            save_last_every: 1,
        }
    }

    // 新規学習のリクエスト JSON(dataset 以外の項目は共通)
    fn gen_start_request(dataset: serde_json::Value) -> serde_json::Value {
        let mut json = serde_json::json!({
            "model_name": "test_model",
            "model_graph": { "nodes": [], "outputs": [] },
            "epoch": 1,
            "batch": 1,
            "device": "cpu",
            "optimizer": { "type": "adam", "learning_rate": 0.001, "weight_decay": 0.0, "beta1": 0.9, "beta2": 0.999, "eps": 1e-8 },
            "loss": { "type": "cross_entropy" },
            "seed": null,
            "data_spec": {
                "type": "image",
                "input_width": 32,
                "input_height": 32,
                "image_task_spec": { "type": "classification" },
                "image_annotation_config": { "type": "pascal_voc", "include_difficult": false }
            },
            "save_last_every": 0
        });
        for (key, value) in dataset.as_object().unwrap() {
            json[key] = value.clone();
        }
        json
    }

    // ModelTrainingConfigDto は model_id と設定が同じ階層に並び(flatten)、
    // データセットのパスは返さないこと
    #[test]
    fn model_config_is_flat_json_without_dataset_path() {
        let dto = ModelTrainingConfigDto {
            model_id: "model-1".to_string(),
            config: gen_saved_config().into(),
        };

        let json = serde_json::to_value(&dto).unwrap();

        assert_eq!(
            json,
            serde_json::json!({
                "model_id": "model-1",
                "model_name": "test_model",
                "model_graph": { "nodes": [], "outputs": [] },
                "epoch": 10,
                "batch": 2,
                "device": "cpu",
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
                "save_last_every": 1,
                "lr_scheduler": { "type": "none", "update_interval": "per_batch", "warmup_epochs": 0 }
            })
        );
    }

    // lr_scheduler を省略したリクエスト(古いクライアント)は none になる
    #[test]
    fn start_request_without_lr_scheduler_is_none() {
        let json = gen_start_request(serde_json::json!({ "dataset_id": "dataset-1" }));
        let dto: TrainingConfigDto = serde_json::from_value(json).unwrap();
        let config = StartTrainingConfig::try_from(dto).unwrap();
        assert_eq!(config.lr_scheduler, LearningRateScheduler::none());
    }

    // 種類ごとのパラメータは "type" と同じ階層に並ぶ
    #[test]
    fn lr_scheduler_json_converts_to_domain_and_back() {
        let cases = [
            (
                serde_json::json!({ "type": "poly", "power": 0.9, "update_interval": "per_batch", "warmup_epochs": 1 }),
                LearningRateScheduler {
                    scheduler: LearningRateSchedulerConfig::Poly { power: 0.9 },
                    update_interval: LearningRateUpdateInterval::PerBatch,
                    warmup_epochs: 1,
                },
            ),
            (
                serde_json::json!({ "type": "cosine", "min_lr": 1e-6, "update_interval": "per_batch", "warmup_epochs": 0 }),
                LearningRateScheduler {
                    scheduler: LearningRateSchedulerConfig::Cosine { min_lr: 1e-6 },
                    update_interval: LearningRateUpdateInterval::PerBatch,
                    warmup_epochs: 0,
                },
            ),
            (
                serde_json::json!({ "type": "step", "step_size": 30, "gamma": 0.1, "update_interval": "per_epoch", "warmup_epochs": 2 }),
                LearningRateScheduler {
                    scheduler: LearningRateSchedulerConfig::Step {
                        step_size: 30,
                        gamma: 0.1,
                    },
                    update_interval: LearningRateUpdateInterval::PerEpoch,
                    warmup_epochs: 2,
                },
            ),
        ];
        for (json, expected) in cases {
            let dto: LearningRateSchedulerDto = serde_json::from_value(json.clone()).unwrap();
            let domain = LearningRateScheduler::from(dto);
            assert_eq!(domain, expected);
            // 保存済みの設定(GET /models/{id}/config)で返す形も同じ
            assert_eq!(
                serde_json::to_value(LearningRateSchedulerDto::from(domain)).unwrap(),
                json
            );
        }
    }

    #[test]
    fn unknown_lr_scheduler_type_is_rejected() {
        let json = serde_json::json!({ "type": "exponential", "update_interval": "per_batch", "warmup_epochs": 0 });
        assert!(serde_json::from_value::<LearningRateSchedulerDto>(json).is_err());
    }

    // 再開リクエストは変えてよい項目だけで ResumeTrainingConfig に変換できること。
    // 以前のクライアントが送る dataset_path は無視される
    #[test]
    fn resume_request_converts_to_resume_training_config() {
        let json = serde_json::json!({
            "epoch": 20,
            "batch": 4,
            "device": "cpu",
            "dataset_path": "/etc",
            "optimizer": { "type": "adam", "learning_rate": 0.001, "weight_decay": 0.0, "beta1": 0.9, "beta2": 0.999, "eps": 1e-8 },
            "loss": { "type": "dice" },
            "save_last_every": 5
        });

        let dto: ResumeTrainingConfigDto = serde_json::from_value(json).unwrap();

        assert_eq!(
            ResumeTrainingConfig::from(dto),
            ResumeTrainingConfig {
                epoch: 20,
                batch: 4,
                device: "cpu".to_string(),
                optimizer: OptimizerConfig::Adam {
                    learning_rate: 0.001,
                    weight_decay: 0.0,
                    beta1: 0.9,
                    beta2: 0.999,
                    eps: 1e-8,
                },
                loss: LossConfig::Dice,
                save_last_every: 5,
            }
        );
    }

    // GUI から届く想定の JSON が StartTrainingConfig まで変換できること
    #[test]
    fn json_converts_to_start_training_config() {
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
            "dataset_id": "dataset-1",
            "optimizer": { "type": "adam_w", "learning_rate": 0.001, "weight_decay": 0.0, "beta1": 0.9, "beta2": 0.999 },
            "loss": { "type": "focal", "gamma": 2.0, "alpha": 0.25 },
            "seed": 42,
            "data_spec": {
                "type": "image",
                "input_width": 256,
                "input_height": 256,
                "image_task_spec": {
                    "type": "segmentation",
                    "ignore_index": 255,
                    "ignore_color_enabled": true,
                    "ignore_color_r": 224,
                    "ignore_color_g": 224,
                    "ignore_color_b": 192
                },
                "image_annotation_config": { "type": "pascal_voc", "include_difficult": false }
            },
            "save_last_every": 0
        }"#;

        let dto: TrainingConfigDto = serde_json::from_str(json).unwrap();
        let config = StartTrainingConfig::try_from(dto).unwrap();

        assert_eq!(config.dataset_id, DatasetId::new("dataset-1").unwrap());
        assert_eq!(
            config.model_graph,
            ModelGraph {
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
            }
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
                    ignore_color: Some(RgbColor {
                        r: 224,
                        g: 224,
                        b: 192
                    }),
                }),
                image_annotation_config: ImageAnnotationConfig::PascalVoc(PascalVocConfig {
                    include_difficult: false,
                }),
            })
        );
    }

    // パスで指定する以前の形式(dataset_id がない)は受け付けないこと
    #[test]
    fn start_request_without_dataset_id_is_rejected() {
        let json = gen_start_request(serde_json::json!({ "dataset_path": "/etc" }));

        assert!(serde_json::from_value::<TrainingConfigDto>(json).is_err());
    }

    // 空の dataset_id は StartTrainingConfig に変換できないこと
    #[test]
    fn empty_dataset_id_is_rejected() {
        let json = gen_start_request(serde_json::json!({ "dataset_id": "" }));
        let dto: TrainingConfigDto = serde_json::from_value(json).unwrap();

        assert_eq!(
            StartTrainingConfig::try_from(dto),
            Err(DatasetIdError::Empty)
        );
    }

    // 知らない種類はエラーになること
    #[test]
    fn unknown_optimizer_type_is_rejected() {
        let result = serde_json::from_str::<OptimizerConfigDto>(r#"{ "type": "rmsprop" }"#);
        assert!(result.is_err());
    }

    // 無視する色が無効なら、r/g/b の値に関係なく ignore_color は None になること
    #[test]
    fn disabled_ignore_color_converts_to_none() {
        let dto: ImageTaskSpecDto = serde_json::from_value(serde_json::json!({
            "type": "segmentation",
            "ignore_index": 255,
            "ignore_color_enabled": false,
            "ignore_color_r": 1,
            "ignore_color_g": 2,
            "ignore_color_b": 3
        }))
        .unwrap();

        assert_eq!(
            ImageTaskSpec::from(dto),
            ImageTaskSpec::Segmentation(SegmentationSpec {
                ignore_index: 255,
                ignore_color: None,
            })
        );
    }

    // 応答(entity -> DTO)では、無視する色の指定がなければ無効・r/g/b は 0 になること
    #[test]
    fn segmentation_without_ignore_color_serializes_as_disabled() {
        let dto: ImageTaskSpecDto = ImageTaskSpec::Segmentation(SegmentationSpec {
            ignore_index: 255,
            ignore_color: None,
        })
        .into();

        assert_eq!(
            serde_json::to_value(&dto).unwrap(),
            serde_json::json!({
                "type": "segmentation",
                "ignore_index": 255,
                "ignore_color_enabled": false,
                "ignore_color_r": 0,
                "ignore_color_g": 0,
                "ignore_color_b": 0
            })
        );
    }

    // 無視する色の項目が欠けたリクエストは拒否されること(フロントエンドは常に 4 項目を送る)
    #[test]
    fn segmentation_without_ignore_color_fields_is_rejected() {
        let result = serde_json::from_value::<ImageTaskSpecDto>(serde_json::json!({
            "type": "segmentation",
            "ignore_index": 255
        }));
        assert!(result.is_err());
    }

    // 独自形式は { "type": "original" } で、パラメータを持たない。往復しても同じ JSON になること
    #[test]
    fn original_annotation_round_trips() {
        let json = serde_json::json!({ "type": "original" });
        let dto: ImageAnnotationConfigDto = serde_json::from_value(json.clone()).unwrap();
        let entity = ImageAnnotationConfig::from(dto);
        assert_eq!(entity, ImageAnnotationConfig::Original);

        let back: ImageAnnotationConfigDto = entity.into();
        assert_eq!(serde_json::to_value(&back).unwrap(), json);
    }
}
