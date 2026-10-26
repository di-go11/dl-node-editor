use super::TrainingStarter;
use super::error::StartTrainingError;
use entities::training::JobId;
use entities::training::config::TrainingConfig;

pub struct StartTraining<S: TrainingStarter> {
    starter: S,
}

impl<S: TrainingStarter> StartTraining<S> {
    pub fn new(starter: S) -> Self {
        Self { starter }
    }
    pub async fn execute(&self, config: &TrainingConfig) -> Result<JobId, StartTrainingError> {
        self.starter.start_training(config).await
    }
}

#[cfg(test)]
mod tests {
    use super::StartTraining;
    use super::StartTrainingError;
    use super::TrainingStarter;
    use entities::model::layer::{ActivationSpec, ActivationType, Conv2DSpec, NodeSpec};
    use entities::model::{ModelGraph, Node, NodeInput, PortRef};
    use entities::training::JobId;
    use entities::training::config::{
        DataSpec, ImageAnnotationConfig, ImageSpec, ImageTaskSpec, Loss, Optimizer,
        PascalVocConfig, SegmentationSpec, TrainingConfig,
    };

    // Conv2D -> ReLU -> Conv2D の最小構成のセグメンテーションモデル
    fn gen_model_graph() -> ModelGraph {
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
                    // source が None = グラフ入力(画像)につなぐ
                    inputs: vec![NodeInput {
                        port: "x".to_string(),
                        source: None,
                    }],
                },
                Node {
                    id: "relu1".to_string(),
                    spec: NodeSpec::Activation(ActivationSpec {
                        activation_type: ActivationType::Relu,
                        dim: 0,
                    }),
                    inputs: vec![NodeInput {
                        port: "x".to_string(),
                        source: Some(PortRef {
                            node_id: "conv1".to_string(),
                            port: "y".to_string(),
                        }),
                    }],
                },
                Node {
                    id: "conv2".to_string(),
                    // PascalVOC は背景込みで21クラス
                    spec: NodeSpec::Conv2D(Conv2DSpec {
                        in_channels: 16,
                        out_channels: 21,
                        kernel_size: 1,
                        stride: 1,
                        padding: 0,
                        dilation: 1,
                    }),
                    inputs: vec![NodeInput {
                        port: "x".to_string(),
                        source: Some(PortRef {
                            node_id: "relu1".to_string(),
                            port: "y".to_string(),
                        }),
                    }],
                },
            ],
            outputs: vec![PortRef {
                node_id: "conv2".to_string(),
                port: "y".to_string(),
            }],
        }
    }

    fn gen_normal_order() -> TrainingConfig {
        TrainingConfig {
            model_name: "test_model".to_string(),
            model_graph: gen_model_graph(),
            epoch: 1,
            batch: 2,
            device: "cpu".to_string(),
            dataset_path: "/data/VOCdevkit/VOC2012".to_string(),
            optimizer: Optimizer::Adam {
                learning_rate: 1e-3,
                weight_decay: 0.0,
                beta1: 0.9,
                beta2: 0.999,
                eps: 1e-8,
            },
            loss: Loss::CrossEntropy,
            resume_from: None,
            seed: Some(42),
            data_spec: DataSpec::Image(ImageSpec {
                input_width: 256,
                input_height: 256,
                image_task_spec: ImageTaskSpec::Segmentation(SegmentationSpec {
                    ignore_index: 255,
                }),
                image_annotation_config: ImageAnnotationConfig::PascalVoc(PascalVocConfig {
                    include_difficult: false,
                }),
            }),
            save_last_every: 0,
        }
    }
    struct FakeStarter {
        result: Result<JobId, StartTrainingError>,
    }
    impl TrainingStarter for FakeStarter {
        async fn start_training(
            &self,
            _training_config: &TrainingConfig,
        ) -> Result<JobId, StartTrainingError> {
            self.result.clone() // &self なので clone して返す(JobId も StartTrainingError も Clone 可)
        }
    }

    #[tokio::test]
    async fn returns_job_id_when_start_succeeds() {
        let expected = JobId::new("1").unwrap();
        let usecase = StartTraining::new(FakeStarter {
            result: Ok(expected.clone()),
        });

        let result = usecase.execute(&gen_normal_order()).await;

        assert_eq!(result, Ok(expected));
    }

    #[tokio::test]
    async fn returns_error_when_start_fails() {
        let err = StartTrainingError::StartOrderFailed("server down".to_string());
        let usecase = StartTraining::new(FakeStarter {
            result: Err(err.clone()),
        });

        let result = usecase.execute(&gen_normal_order()).await;

        assert_eq!(result, Err(err));
    }
}
