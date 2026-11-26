use crate::model::ModelGraph;
use crate::validation::{ConfigViolation, Violations};

use super::data_spec::DataSpec;

// training_config
// 値の範囲は validate() で確認する。設定の誤りは C++ に送る前にここで見つけ、すべてまとめて返す
// (docs/issues/2026-11-26/学習設定の検証をRustに集める.md)。
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

impl TrainingConfig {
    // 設定の値の範囲を確認する。違反があれば、見つかったものをすべて返す。
    // dataset_path はデータセット ID から決まる値なので確認しない。
    pub fn validate(&self) -> Result<(), Vec<ConfigViolation>> {
        let mut v = Violations::default();
        if self.model_name.trim().is_empty() {
            v.push("model_name", "空にはできません");
        }
        v.at_least("epoch", self.epoch.into(), 1);
        v.at_least("batch", self.batch.into(), 1);
        if !is_valid_device(&self.device) {
            v.push(
                "device",
                format!(
                    "cpu / cuda / cuda:<番号> のいずれかにしてください({})",
                    self.device
                ),
            );
        }
        self.model_graph.validate_params(&mut v);
        self.optimizer.validate(&mut v);
        self.lr_scheduler
            .validate(self.epoch, self.optimizer.learning_rate(), &mut v);
        self.loss.validate(&mut v);
        self.data_spec.validate(&mut v);
        v.into_result()
    }
}

// C++ の parseComputeDevice() と同じ形式: "cpu" / "cuda" / "cuda:<0 以上の整数>"。
// そのデバイスが実際にあるかは実行環境によるので、ここでは確認しない。
fn is_valid_device(device: &str) -> bool {
    match device {
        "cpu" | "cuda" => true,
        _ => device.strip_prefix("cuda:").is_some_and(|index| {
            !index.is_empty()
                && index.bytes().all(|b| b.is_ascii_digit())
                && index.parse::<i32>().is_ok() // C++ 側は int で受け取る
        }),
    }
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

impl Optimizer {
    pub fn learning_rate(&self) -> f64 {
        match self {
            Optimizer::Adam { learning_rate, .. }
            | Optimizer::AdamW { learning_rate, .. }
            | Optimizer::Sgd { learning_rate, .. } => *learning_rate,
        }
    }

    fn validate(&self, v: &mut Violations) {
        v.greater_than_zero("optimizer.learning_rate", self.learning_rate());
        match self {
            Optimizer::Adam {
                weight_decay,
                beta1,
                beta2,
                eps,
                ..
            } => {
                v.non_negative("optimizer.weight_decay", *weight_decay);
                validate_beta(v, "optimizer.beta1", *beta1);
                validate_beta(v, "optimizer.beta2", *beta2);
                v.greater_than_zero("optimizer.eps", *eps);
            }
            Optimizer::AdamW {
                weight_decay,
                beta1,
                beta2,
                ..
            } => {
                v.non_negative("optimizer.weight_decay", *weight_decay);
                validate_beta(v, "optimizer.beta1", *beta1);
                validate_beta(v, "optimizer.beta2", *beta2);
            }
            Optimizer::Sgd {
                weight_decay,
                momentum,
                nesterov,
                ..
            } => {
                v.non_negative("optimizer.weight_decay", *weight_decay);
                v.non_negative("optimizer.momentum", *momentum);
                // Nesterov は momentum を使う手法なので、momentum が 0 だと意味がない(libtorch の SGD も拒否する)
                if *nesterov && (momentum.is_nan() || *momentum <= 0.0) {
                    v.push(
                        "optimizer.momentum",
                        format!("nesterov を使うときは 0 より大きくしてください({momentum})"),
                    );
                }
            }
        }
    }
}

// Adam / AdamW の beta は移動平均の減衰率。1 以上だと過去の値が減衰しなくなる
fn validate_beta(v: &mut Violations, field: &str, beta: f64) {
    if !(0.0..1.0).contains(&beta) {
        v.push(field, format!("0 以上 1 未満にしてください({beta})"));
    }
}

// LrScheduler
#[derive(Debug, PartialEq, Clone)]
pub struct LearningRateScheduler {
    pub scheduler: LearningRateSchedulerConfig,
    pub update_interval: LearningRateUpdateInterval,
    pub warmup_epochs: u32,
}

impl LearningRateScheduler {
    // スケジューラなし(学習率は Optimizer の値のまま)。warmup もしない。
    // 更新の単位は使われないが、proto の既定値(PER_BATCH)に合わせる
    pub fn none() -> Self {
        Self {
            scheduler: LearningRateSchedulerConfig::None,
            update_interval: LearningRateUpdateInterval::PerBatch,
            warmup_epochs: 0,
        }
    }

    // epoch と learning_rate は TrainingConfig 側の値(warmup と min_lr の上限に使う)
    fn validate(&self, epoch: u32, learning_rate: f64, v: &mut Violations) {
        match &self.scheduler {
            LearningRateSchedulerConfig::None => {
                if self.warmup_epochs != 0 {
                    v.push(
                        "lr_scheduler.warmup_epochs",
                        format!(
                            "スケジューラが none のときは 0 にしてください({})",
                            self.warmup_epochs
                        ),
                    );
                }
            }
            LearningRateSchedulerConfig::Poly { power } => {
                v.greater_than_zero("lr_scheduler.power", *power);
            }
            LearningRateSchedulerConfig::Cosine { min_lr } => {
                v.non_negative("lr_scheduler.min_lr", *min_lr);
                if *min_lr > learning_rate {
                    v.push(
                        "lr_scheduler.min_lr",
                        format!(
                            "optimizer.learning_rate({learning_rate})以下にしてください({min_lr})"
                        ),
                    );
                }
            }
            LearningRateSchedulerConfig::Step { step_size, gamma } => {
                v.at_least("lr_scheduler.step_size", (*step_size).into(), 1);
                if !(*gamma > 0.0 && *gamma <= 1.0) {
                    v.push(
                        "lr_scheduler.gamma",
                        format!("0 より大きく 1 以下にしてください({gamma})"),
                    );
                }
            }
        }
        // none は上で 0 以外を断っているので、ここでは none 以外だけを見る
        if self.scheduler != LearningRateSchedulerConfig::None && self.warmup_epochs >= epoch {
            v.push(
                "lr_scheduler.warmup_epochs",
                format!(
                    "epoch({epoch})より小さくしてください({})",
                    self.warmup_epochs
                ),
            );
        }
    }
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

impl Loss {
    fn validate(&self, v: &mut Violations) {
        match self {
            Loss::Focal { gamma, alpha } => {
                v.non_negative("loss.gamma", *gamma);
                // alpha は損失全体にかける係数。0 だと損失が常に 0 になり学習しない
                if !(*alpha > 0.0 && *alpha <= 1.0) {
                    v.push(
                        "loss.alpha",
                        format!("0 より大きく 1 以下にしてください({alpha})"),
                    );
                }
            }
            Loss::Combo { alpha } => {
                // 0 なら Dice だけ、1 なら Cross Entropy だけになる。どちらも使える
                if !(0.0..=1.0).contains(alpha) {
                    v.push(
                        "loss.alpha",
                        format!("0 以上 1 以下にしてください({alpha})"),
                    );
                }
            }
            Loss::CrossEntropy | Loss::Mse | Loss::Dice | Loss::Boundary => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::layer::{Conv2DSpec, NodeSpec};
    use crate::model::{Node, NodeInput, PortRef};
    use crate::training::config::{
        ImageAnnotationConfig, ImageSpec, ImageTaskSpec, PascalVocConfig, SegmentationSpec,
    };

    fn valid_config() -> TrainingConfig {
        TrainingConfig {
            model_name: "model".to_string(),
            model_graph: ModelGraph {
                nodes: vec![Node {
                    id: "conv".to_string(),
                    spec: NodeSpec::Conv2D(Conv2DSpec {
                        in_channels: 3,
                        out_channels: 21,
                        kernel_size: 3,
                        stride: 1,
                        padding: 1,
                        dilation: 1,
                    }),
                    inputs: vec![NodeInput {
                        port: "x".to_string(),
                        source: Some(PortRef {
                            node_id: String::new(),
                            port: String::new(),
                        }),
                    }],
                }],
                outputs: vec![PortRef {
                    node_id: "conv".to_string(),
                    port: "y".to_string(),
                }],
            },
            epoch: 10,
            batch: 4,
            device: "cpu".to_string(),
            dataset_path: "/data/voc".to_string(),
            optimizer: Optimizer::Adam {
                learning_rate: 1e-3,
                weight_decay: 0.0,
                beta1: 0.9,
                beta2: 0.999,
                eps: 1e-8,
            },
            loss: Loss::CrossEntropy,
            seed: None,
            data_spec: DataSpec::Image(ImageSpec {
                input_width: 256,
                input_height: 256,
                image_task_spec: ImageTaskSpec::Segmentation(SegmentationSpec {
                    ignore_index: 255,
                    ignore_color: None,
                }),
                image_annotation_config: ImageAnnotationConfig::PascalVoc(PascalVocConfig {
                    include_difficult: false,
                }),
            }),
            save_last_every: 0,
            lr_scheduler: LearningRateScheduler {
                scheduler: LearningRateSchedulerConfig::Poly { power: 0.9 },
                update_interval: LearningRateUpdateInterval::PerBatch,
                warmup_epochs: 1,
            },
        }
    }

    // 違反のあった項目名だけを並べる(メッセージの文言はテストしない)
    fn violated_fields(config: &TrainingConfig) -> Vec<String> {
        match config.validate() {
            Ok(()) => vec![],
            Err(violations) => violations.into_iter().map(|v| v.field).collect(),
        }
    }

    fn sgd(momentum: f64, nesterov: bool) -> Optimizer {
        Optimizer::Sgd {
            learning_rate: 0.01,
            weight_decay: 0.0,
            momentum,
            nesterov,
        }
    }

    fn adam_with_betas(beta1: f64, beta2: f64) -> Optimizer {
        Optimizer::Adam {
            learning_rate: 1e-3,
            weight_decay: 0.0,
            beta1,
            beta2,
            eps: 1e-8,
        }
    }

    #[test]
    fn valid_config_passes() {
        assert_eq!(valid_config().validate(), Ok(()));
    }

    #[test]
    fn returns_all_violations_not_only_the_first() {
        let config = TrainingConfig {
            epoch: 0,
            batch: 0,
            optimizer: Optimizer::AdamW {
                learning_rate: 0.0,
                weight_decay: 0.0,
                beta1: 0.9,
                beta2: 0.999,
            },
            ..valid_config()
        };
        // epoch = 0 なので warmup_epochs(1)>= epoch にもなる
        assert_eq!(
            violated_fields(&config),
            vec![
                "epoch",
                "batch",
                "optimizer.learning_rate",
                "lr_scheduler.warmup_epochs"
            ]
        );
    }

    #[test]
    fn rejects_blank_model_name() {
        for name in ["", "   "] {
            let config = TrainingConfig {
                model_name: name.to_string(),
                ..valid_config()
            };
            assert_eq!(violated_fields(&config), vec!["model_name"], "{name:?}");
        }
    }

    #[test]
    fn device_accepts_the_same_formats_as_cpp() {
        for device in ["cpu", "cuda", "cuda:0", "cuda:12"] {
            let config = TrainingConfig {
                device: device.to_string(),
                ..valid_config()
            };
            assert_eq!(violated_fields(&config), Vec::<String>::new(), "{device}");
        }
        for device in [
            "",
            "gpu",
            "CUDA",
            "cuda:",
            "cuda:-1",
            "cuda:+1",
            "cuda:a",
            "cuda:99999999999",
        ] {
            let config = TrainingConfig {
                device: device.to_string(),
                ..valid_config()
            };
            assert_eq!(violated_fields(&config), vec!["device"], "{device}");
        }
    }

    #[test]
    fn learning_rate_must_be_greater_than_zero_for_every_optimizer() {
        let optimizers = [
            Optimizer::Adam {
                learning_rate: 0.0,
                weight_decay: 0.0,
                beta1: 0.9,
                beta2: 0.999,
                eps: 1e-8,
            },
            Optimizer::AdamW {
                learning_rate: 0.0,
                weight_decay: 0.0,
                beta1: 0.9,
                beta2: 0.999,
            },
            Optimizer::Sgd {
                learning_rate: 0.0,
                weight_decay: 0.0,
                momentum: 0.0,
                nesterov: false,
            },
        ];
        for optimizer in optimizers {
            let config = TrainingConfig {
                optimizer,
                // poly なら learning_rate に関係する規則はほかにない
                ..valid_config()
            };
            assert_eq!(violated_fields(&config), vec!["optimizer.learning_rate"]);
        }
    }

    #[test]
    fn weight_decay_must_be_non_negative() {
        let config = TrainingConfig {
            optimizer: Optimizer::Sgd {
                learning_rate: 0.01,
                weight_decay: -1e-4,
                momentum: 0.9,
                nesterov: false,
            },
            ..valid_config()
        };
        assert_eq!(violated_fields(&config), vec!["optimizer.weight_decay"]);
    }

    #[test]
    fn beta_must_be_in_zero_to_one_exclusive() {
        let ok = TrainingConfig {
            optimizer: adam_with_betas(0.0, 0.999),
            ..valid_config()
        };
        assert_eq!(violated_fields(&ok), Vec::<String>::new());

        let ng = TrainingConfig {
            optimizer: adam_with_betas(-0.1, 1.0),
            ..valid_config()
        };
        assert_eq!(
            violated_fields(&ng),
            vec!["optimizer.beta1", "optimizer.beta2"]
        );
    }

    #[test]
    fn adam_eps_must_be_greater_than_zero() {
        let config = TrainingConfig {
            optimizer: Optimizer::Adam {
                learning_rate: 1e-3,
                weight_decay: 0.0,
                beta1: 0.9,
                beta2: 0.999,
                eps: 0.0,
            },
            ..valid_config()
        };
        assert_eq!(violated_fields(&config), vec!["optimizer.eps"]);
    }

    #[test]
    fn nesterov_requires_positive_momentum() {
        let ok = [sgd(0.0, false), sgd(0.9, true)];
        for optimizer in ok {
            let config = TrainingConfig {
                optimizer,
                ..valid_config()
            };
            assert_eq!(violated_fields(&config), Vec::<String>::new());
        }
        let config = TrainingConfig {
            optimizer: sgd(0.0, true),
            ..valid_config()
        };
        assert_eq!(violated_fields(&config), vec!["optimizer.momentum"]);
    }

    fn with_scheduler(
        scheduler: LearningRateSchedulerConfig,
        warmup_epochs: u32,
    ) -> TrainingConfig {
        TrainingConfig {
            lr_scheduler: LearningRateScheduler {
                scheduler,
                update_interval: LearningRateUpdateInterval::PerEpoch,
                warmup_epochs,
            },
            ..valid_config()
        }
    }

    #[test]
    fn none_scheduler_must_not_have_warmup() {
        assert_eq!(
            violated_fields(&with_scheduler(LearningRateSchedulerConfig::None, 0)),
            Vec::<String>::new()
        );
        assert_eq!(
            violated_fields(&with_scheduler(LearningRateSchedulerConfig::None, 1)),
            vec!["lr_scheduler.warmup_epochs"]
        );
    }

    #[test]
    fn warmup_epochs_must_be_less_than_epoch() {
        let poly = LearningRateSchedulerConfig::Poly { power: 0.9 };
        // valid_config の epoch は 10
        assert_eq!(
            violated_fields(&with_scheduler(poly.clone(), 9)),
            Vec::<String>::new()
        );
        assert_eq!(
            violated_fields(&with_scheduler(poly, 10)),
            vec!["lr_scheduler.warmup_epochs"]
        );
    }

    #[test]
    fn poly_power_must_be_greater_than_zero() {
        let config = with_scheduler(LearningRateSchedulerConfig::Poly { power: 0.0 }, 0);
        assert_eq!(violated_fields(&config), vec!["lr_scheduler.power"]);
    }

    #[test]
    fn cosine_min_lr_must_be_between_zero_and_learning_rate() {
        // valid_config の learning_rate は 1e-3
        for min_lr in [0.0, 1e-3] {
            let config = with_scheduler(LearningRateSchedulerConfig::Cosine { min_lr }, 0);
            assert_eq!(violated_fields(&config), Vec::<String>::new(), "{min_lr}");
        }
        for min_lr in [-1e-6, 2e-3] {
            let config = with_scheduler(LearningRateSchedulerConfig::Cosine { min_lr }, 0);
            assert_eq!(
                violated_fields(&config),
                vec!["lr_scheduler.min_lr"],
                "{min_lr}"
            );
        }
    }

    #[test]
    fn step_size_and_gamma_ranges() {
        let ok = with_scheduler(
            LearningRateSchedulerConfig::Step {
                step_size: 1,
                gamma: 1.0,
            },
            0,
        );
        assert_eq!(violated_fields(&ok), Vec::<String>::new());

        let ng = with_scheduler(
            LearningRateSchedulerConfig::Step {
                step_size: 0,
                gamma: 0.0,
            },
            0,
        );
        assert_eq!(
            violated_fields(&ng),
            vec!["lr_scheduler.step_size", "lr_scheduler.gamma"]
        );

        let gamma_too_large = with_scheduler(
            LearningRateSchedulerConfig::Step {
                step_size: 1,
                gamma: 1.5,
            },
            0,
        );
        assert_eq!(
            violated_fields(&gamma_too_large),
            vec!["lr_scheduler.gamma"]
        );
    }

    #[test]
    fn focal_gamma_and_alpha_ranges() {
        let with_loss = |loss| TrainingConfig {
            loss,
            ..valid_config()
        };
        assert_eq!(
            violated_fields(&with_loss(Loss::Focal {
                gamma: 0.0,
                alpha: 1.0
            })),
            Vec::<String>::new()
        );
        assert_eq!(
            violated_fields(&with_loss(Loss::Focal {
                gamma: -1.0,
                alpha: 0.0
            })),
            vec!["loss.gamma", "loss.alpha"]
        );
    }

    #[test]
    fn combo_alpha_accepts_both_ends() {
        let with_alpha = |alpha| TrainingConfig {
            loss: Loss::Combo { alpha },
            ..valid_config()
        };
        for alpha in [0.0, 1.0] {
            assert_eq!(violated_fields(&with_alpha(alpha)), Vec::<String>::new());
        }
        for alpha in [-0.1, 1.1] {
            assert_eq!(violated_fields(&with_alpha(alpha)), vec!["loss.alpha"]);
        }
    }

    #[test]
    fn includes_violations_from_model_graph_and_data_spec() {
        let mut config = valid_config();
        if let NodeSpec::Conv2D(conv) = &mut config.model_graph.nodes[0].spec {
            conv.stride = 0;
        }
        let DataSpec::Image(image) = &mut config.data_spec;
        image.input_width = 0;
        assert_eq!(
            violated_fields(&config),
            vec!["model_graph.nodes[0].spec.stride", "data_spec.input_width"]
        );
    }
}
