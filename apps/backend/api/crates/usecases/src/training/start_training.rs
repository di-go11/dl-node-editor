use crate::training::ProgressRecordingScheduler;

use super::ModelIdGenerator;
use super::TrainingRunRegistar;
use super::TrainingStarter;
use super::error::StartTrainingError;
use entities::model::ModelId;
use entities::training::JobId;
use entities::training::config::TrainingConfig;

pub struct StartTraining<S, R, G, K> {
    starter: S,
    repository: R,
    id_generator: G,
    scheduler: K,
}

impl<S: TrainingStarter, R: TrainingRunRegistar, G: ModelIdGenerator, K: ProgressRecordingScheduler>
    StartTraining<S, R, G, K>
{
    pub fn new(starter: S, repository: R, id_generator: G, scheduler: K) -> Self {
        Self {
            starter,
            repository,
            id_generator,
            scheduler,
        }
    }
    // 新規学習を開始する(学習再開は別のユースケースにする)。
    // C++開始後にinsert_training_runが失敗した場合、C++は走り続ける(issue 作業8)。
    pub async fn execute(&self, config: &TrainingConfig) -> Result<JobId, StartTrainingError> {
        let model_id: ModelId = self.id_generator.generate();
        self.repository
            .insert_model(&model_id, &config.model_name, &config.model_graph)
            .await
            .map_err(|e| StartTrainingError::RecordFailed(e.to_string()))?;

        let job_id = self.starter.start_training(config, &model_id).await?;
        self.repository
            .insert_training_run(&job_id, config, &model_id)
            .await
            .map_err(|e| StartTrainingError::RecordFailed(e.to_string()))?;
        self.scheduler.schedule(job_id.clone()); // insert_training_runが成功したときだけ呼ぶ、
        Ok(job_id)
    }
}

#[cfg(test)]
mod tests {
    use super::ModelIdGenerator;
    use super::StartTraining;
    use super::StartTrainingError;
    use super::TrainingRunRegistar;
    use super::TrainingStarter;
    use crate::training::ProgressRecordingScheduler;
    use crate::training::RecordError;
    use entities::model::layer::{ActivationSpec, ActivationType, Conv2DSpec, NodeSpec};
    use entities::model::{ModelGraph, Node, NodeInput, PortRef};
    use entities::training::config::{
        DataSpec, ImageAnnotationConfig, ImageSpec, ImageTaskSpec, Loss, Optimizer,
        PascalVocConfig, SegmentationSpec, TrainingConfig,
    };
    use entities::{
        model::ModelId,
        training::{JobId, TrainingJobStatus},
    };
    use std::sync::{Arc, Mutex};

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
    // 呼び出された順番を記録する。starterとrepositoryで共有して、呼び出し順を確認する
    type CallLog = Arc<Mutex<Vec<&'static str>>>;

    struct FakeStarter {
        result: Result<JobId, StartTrainingError>,
        log: CallLog,
    }
    impl TrainingStarter for FakeStarter {
        async fn start_training(
            &self,
            _training_config: &TrainingConfig,
            _model_id: &ModelId,
        ) -> Result<JobId, StartTrainingError> {
            self.log.lock().unwrap().push("start_training");
            self.result.clone() // &self なので clone して返す(JobId も StartTrainingError も Clone 可)
        }
    }

    struct FakeRepository {
        insert_model_result: Result<(), RecordError>,
        insert_training_run_result: Result<(), RecordError>,
        log: CallLog,
        // training_runsに紐づけられたmodel_idを記録する
        run_model_id: Mutex<Option<ModelId>>,
    }
    impl TrainingRunRegistar for FakeRepository {
        async fn insert_model(
            &self,
            _model_id: &ModelId,
            _model_name: &str,
            _model_graph: &ModelGraph,
        ) -> Result<(), RecordError> {
            self.log.lock().unwrap().push("insert_model");
            self.insert_model_result.clone()
        }
        async fn insert_training_run(
            &self,
            _job_id: &JobId,
            _config: &TrainingConfig,
            model_id: &ModelId,
        ) -> Result<(), RecordError> {
            self.log.lock().unwrap().push("insert_training_run");
            *self.run_model_id.lock().unwrap() = Some(model_id.clone());
            self.insert_training_run_result.clone()
        }
        async fn update_training_run(
            &self,
            _job_id: &JobId,
            _status: &TrainingJobStatus,
        ) -> Result<(), RecordError> {
            self.log.lock().unwrap().push("update_training_run");
            Ok(())
        }
    }

    // 常に同じIDを返す
    struct FakeIdGenerator;
    impl ModelIdGenerator for FakeIdGenerator {
        fn generate(&self) -> ModelId {
            ModelId::new("model-1").unwrap()
        }
    }
    // TODO ProgressRecordingSchedukerの内部処理が決まったらテストも作る。
    struct FakeScheduler {
        job_ids: Mutex<Vec<JobId>>,
    }
    impl ProgressRecordingScheduler for FakeScheduler {
        fn schedule(&self, job_id: JobId) {}
    }

    fn gen_usecase(
        start_result: Result<JobId, StartTrainingError>,
        insert_model_result: Result<(), RecordError>,
        insert_training_run_result: Result<(), RecordError>,
    ) -> (
        StartTraining<FakeStarter, FakeRepository, FakeIdGenerator, FakeScheduler>,
        CallLog,
    ) {
        let log = CallLog::default();
        let usecase = StartTraining::new(
            FakeStarter {
                result: start_result,
                log: Arc::clone(&log),
            },
            FakeRepository {
                insert_model_result,
                insert_training_run_result,
                log: Arc::clone(&log),
                run_model_id: Mutex::new(None),
            },
            FakeIdGenerator,
            FakeScheduler {
                job_ids: Mutex::new(vec![]),
            },
        );
        (usecase, log)
    }

    #[tokio::test]
    async fn returns_job_id_when_start_succeeds() {
        let expected = JobId::new("1").unwrap();
        let (usecase, log) = gen_usecase(Ok(expected.clone()), Ok(()), Ok(()));

        let result = usecase.execute(&gen_normal_order()).await;

        assert_eq!(result, Ok(expected));
        // modelはtraining_runsから外部キーで参照されるため、先にinsertされる
        assert_eq!(
            *log.lock().unwrap(),
            vec!["insert_model", "start_training", "insert_training_run"]
        );
        // 新規学習では生成したmodel_idが紐づく
        assert_eq!(
            *usecase.repository.run_model_id.lock().unwrap(),
            Some(ModelId::new("model-1").unwrap())
        );
    }

    #[tokio::test]
    async fn returns_error_when_start_fails() {
        let err = StartTrainingError::StartOrderFailed("server down".to_string());
        let (usecase, log) = gen_usecase(Err(err.clone()), Ok(()), Ok(()));

        let result = usecase.execute(&gen_normal_order()).await;

        assert_eq!(result, Err(err));
        // 学習が始まっていないので、training_runsにはinsertしない
        assert_eq!(*log.lock().unwrap(), vec!["insert_model", "start_training"]);
    }

    #[tokio::test]
    async fn does_not_start_when_insert_model_fails() {
        let (usecase, log) = gen_usecase(
            Ok(JobId::new("1").unwrap()),
            Err(RecordError::RecordFailed("unique".to_string())),
            Ok(()),
        );

        let result = usecase.execute(&gen_normal_order()).await;

        assert!(matches!(result, Err(StartTrainingError::RecordFailed(_))));
        // 保存できない学習は始めない
        assert_eq!(*log.lock().unwrap(), vec!["insert_model"]);
    }

    #[tokio::test]
    async fn returns_record_failed_when_insert_training_run_fails() {
        let (usecase, _log) = gen_usecase(
            Ok(JobId::new("1").unwrap()),
            Ok(()),
            Err(RecordError::RecordFailed("db locked".to_string())),
        );

        let result = usecase.execute(&gen_normal_order()).await;

        assert!(matches!(result, Err(StartTrainingError::RecordFailed(_))));
    }
}
