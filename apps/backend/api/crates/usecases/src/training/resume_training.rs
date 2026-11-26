use super::ProgressRecordingScheduler;
use super::TrainingResumer;
use super::TrainingRunRegistar;
use super::config::ResumeTrainingConfig;
use super::error::{ResumeTrainingError, StartTrainingError};
use crate::model::error::FetchModelError;
use crate::model::ports::ModelTrainingConfigProvider;
use entities::model::ModelId;
use entities::training::JobId;
use entities::training::config::Optimizer;
use std::mem::discriminant;

// エラーメッセージ用の Optimizer の種類名
fn optimizer_kind(optimizer: &Optimizer) -> &'static str {
    match optimizer {
        Optimizer::Adam { .. } => "adam",
        Optimizer::AdamW { .. } => "adamw",
        Optimizer::Sgd { .. } => "sgd",
    }
}

// 学習済みモデルの学習を再開する(新規学習は StartTraining)。
// 再開元の .pt は C++ が <model_id>_last.pt に決めるので、Rust は model_id と resume = true を渡すだけ。
pub struct ResumeTraining<C, S, R, K> {
    config: C,
    resumer: S,
    repository: R,
    scheduler: K,
}

impl<C, S, R, K> ResumeTraining<C, S, R, K>
where
    C: ModelTrainingConfigProvider,
    S: TrainingResumer,
    R: TrainingRunRegistar,
    K: ProgressRecordingScheduler,
{
    pub fn new(config: C, resumer: S, repository: R, scheduler: K) -> Self {
        Self {
            config,
            resumer,
            repository,
            scheduler,
        }
    }

    // C++開始後にinsert_training_runが失敗した場合、C++は走り続ける(issue 作業8。StartTrainingと同じ)。
    pub async fn execute(
        &self,
        model_id: &ModelId,
        input: &ResumeTrainingConfig,
    ) -> Result<JobId, ResumeTrainingError> {
        // 前回の学習設定を読む。固定項目はこの値を使う
        let saved = self.config.fetch(model_id).await.map_err(|e| match e {
            FetchModelError::NotFound(msg) => ResumeTrainingError::ModelNotFound(msg),
            FetchModelError::GraphNotSaved(msg) => ResumeTrainingError::NotResumable(msg),
            FetchModelError::InvalidQuery(msg) | FetchModelError::InvalidData(msg) => {
                ResumeTrainingError::ReadFailed(msg)
            }
        })?;

        // Optimizer の種類が違うと、C++ は checkpoint の optimizer 状態を読めずに例外を投げるので、送る前に拒否する
        if discriminant(&saved.optimizer) != discriminant(&input.optimizer) {
            return Err(ResumeTrainingError::OptimizerTypeChanged(format!(
                "saved: {}, requested: {}",
                optimizer_kind(&saved.optimizer),
                optimizer_kind(&input.optimizer)
            )));
        }
        let config = input.apply_to(saved);
        config
            .validate()
            .map_err(ResumeTrainingError::InvalidConfig)?;

        let job_id = self.resumer.resume_training(&config, model_id).await?;
        // 再開では model の行は作らず、同じ model_id に新しい run を追加する
        self.repository
            .insert_training_run(&job_id, &config, model_id)
            .await
            .map_err(|e| StartTrainingError::RecordFailed(e.to_string()))?;
        self.scheduler.schedule(job_id.clone()); // insert_training_runが成功したときだけ呼ぶ
        Ok(job_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::training::RecordError;
    use entities::model::layer::{Conv2DSpec, NodeSpec};
    use entities::model::{ModelGraph, Node, NodeInput, PortRef};
    use entities::training::TrainingJobStatus;
    use entities::training::config::{
        DataSpec, ImageAnnotationConfig, ImageSpec, ImageTaskSpec, Loss, Optimizer,
        PascalVocConfig, SegmentationSpec, TrainingConfig,
    };
    use std::sync::{Arc, Mutex};

    fn gen_config() -> TrainingConfig {
        TrainingConfig {
            model_name: "test_model".to_string(),
            model_graph: ModelGraph {
                nodes: vec![Node {
                    id: "conv1".to_string(),
                    spec: NodeSpec::Conv2D(Conv2DSpec {
                        in_channels: 3,
                        out_channels: 21,
                        kernel_size: 1,
                        stride: 1,
                        padding: 0,
                        dilation: 1,
                    }),
                    inputs: vec![NodeInput {
                        port: "x".to_string(),
                        source: None,
                    }],
                }],
                outputs: vec![PortRef {
                    node_id: "conv1".to_string(),
                    port: "y".to_string(),
                }],
            },
            epoch: 10,
            batch: 2,
            device: "cpu".to_string(),
            dataset_path: "/datasets/dataset-1".to_string(),
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
                    ignore_color: None,
                }),
                image_annotation_config: ImageAnnotationConfig::PascalVoc(PascalVocConfig {
                    include_difficult: false,
                }),
            }),
            save_last_every: 1,
        }
    }

    // 呼び出された順番を記録する。各フェイクで共有して、呼び出し順を確認する
    type CallLog = Arc<Mutex<Vec<&'static str>>>;

    struct FakeConfigProvider {
        result: Result<TrainingConfig, FetchModelError>,
    }
    impl ModelTrainingConfigProvider for FakeConfigProvider {
        async fn fetch(&self, _model_id: &ModelId) -> Result<TrainingConfig, FetchModelError> {
            self.result.clone()
        }
    }

    struct FakeResumer {
        result: Result<JobId, StartTrainingError>,
        log: CallLog,
        model_id: Mutex<Option<ModelId>>,
        // C++ に渡された設定(固定項目が DB の値になっているかの確認用)
        config: Mutex<Option<TrainingConfig>>,
    }
    impl TrainingResumer for FakeResumer {
        async fn resume_training(
            &self,
            training_config: &TrainingConfig,
            model_id: &ModelId,
        ) -> Result<JobId, StartTrainingError> {
            self.log.lock().unwrap().push("resume_training");
            *self.model_id.lock().unwrap() = Some(model_id.clone());
            *self.config.lock().unwrap() = Some(training_config.clone());
            self.result.clone()
        }
    }

    struct FakeRepository {
        insert_training_run_result: Result<(), RecordError>,
        log: CallLog,
        run_model_id: Mutex<Option<ModelId>>,
        run_config: Mutex<Option<TrainingConfig>>,
    }
    impl TrainingRunRegistar for FakeRepository {
        async fn insert_model(
            &self,
            _model_id: &ModelId,
            _model_name: &str,
            _model_graph: &ModelGraph,
        ) -> Result<(), RecordError> {
            self.log.lock().unwrap().push("insert_model");
            Ok(())
        }
        async fn insert_training_run(
            &self,
            _job_id: &JobId,
            config: &TrainingConfig,
            model_id: &ModelId,
        ) -> Result<(), RecordError> {
            self.log.lock().unwrap().push("insert_training_run");
            *self.run_model_id.lock().unwrap() = Some(model_id.clone());
            *self.run_config.lock().unwrap() = Some(config.clone());
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

    struct FakeScheduler {
        log: CallLog,
    }
    impl ProgressRecordingScheduler for FakeScheduler {
        fn schedule(&self, _job_id: JobId) {
            self.log.lock().unwrap().push("schedule");
        }
    }

    type Usecase = ResumeTraining<FakeConfigProvider, FakeResumer, FakeRepository, FakeScheduler>;

    fn gen_usecase(
        fetch_result: Result<TrainingConfig, FetchModelError>,
        resume_result: Result<JobId, StartTrainingError>,
        insert_training_run_result: Result<(), RecordError>,
    ) -> (Usecase, CallLog) {
        let log = CallLog::default();
        let usecase = ResumeTraining::new(
            FakeConfigProvider {
                result: fetch_result,
            },
            FakeResumer {
                result: resume_result,
                log: Arc::clone(&log),
                model_id: Mutex::new(None),
                config: Mutex::new(None),
            },
            FakeRepository {
                insert_training_run_result,
                log: Arc::clone(&log),
                run_model_id: Mutex::new(None),
                run_config: Mutex::new(None),
            },
            FakeScheduler {
                log: Arc::clone(&log),
            },
        );
        (usecase, log)
    }

    fn model_id() -> ModelId {
        ModelId::new("model-1").unwrap()
    }

    // 前回(gen_config)から、変えてよい項目をすべて変えた入力
    fn gen_input() -> ResumeTrainingConfig {
        ResumeTrainingConfig {
            epoch: 20,
            batch: 4,
            device: "cuda:0".to_string(),
            optimizer: Optimizer::Adam {
                learning_rate: 1e-4,
                weight_decay: 1e-5,
                beta1: 0.8,
                beta2: 0.99,
                eps: 1e-7,
            },
            loss: Loss::Dice,
            save_last_every: 5,
        }
    }

    #[tokio::test]
    async fn uses_saved_fixed_fields_and_requested_editable_fields() {
        let (usecase, _log) = gen_usecase(Ok(gen_config()), Ok(JobId::new("2").unwrap()), Ok(()));
        let input = gen_input();

        usecase.execute(&model_id(), &input).await.unwrap();

        let saved = gen_config();
        let expected = TrainingConfig {
            // 固定項目は前回の値
            model_name: saved.model_name,
            model_graph: saved.model_graph,
            data_spec: saved.data_spec,
            seed: saved.seed,
            // データセットも前回のまま(再開ではクライアントにパスを指定させない)
            dataset_path: saved.dataset_path,
            // 変えてよい項目は入力の値
            epoch: input.epoch,
            batch: input.batch,
            device: input.device,
            optimizer: input.optimizer,
            loss: input.loss,
            save_last_every: input.save_last_every,
        };
        // C++ に送る設定と、training_runs に記録する設定は同じ
        assert_eq!(
            *usecase.resumer.config.lock().unwrap(),
            Some(expected.clone())
        );
        assert_eq!(
            *usecase.repository.run_config.lock().unwrap(),
            Some(expected)
        );
    }

    #[tokio::test]
    async fn rejects_optimizer_type_change_without_resuming() {
        let (usecase, log) = gen_usecase(Ok(gen_config()), Ok(JobId::new("2").unwrap()), Ok(()));
        let input = ResumeTrainingConfig {
            optimizer: Optimizer::Sgd {
                learning_rate: 1e-2,
                weight_decay: 0.0,
                momentum: 0.9,
                nesterov: false,
            },
            ..gen_input()
        };

        let result = usecase.execute(&model_id(), &input).await;

        assert_eq!(
            result,
            Err(ResumeTrainingError::OptimizerTypeChanged(
                "saved: adam, requested: sgd".to_string()
            ))
        );
        // C++ には送らない
        assert!(log.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn resumes_with_given_model_id_without_inserting_model() {
        let expected = JobId::new("2").unwrap();
        let (usecase, log) = gen_usecase(Ok(gen_config()), Ok(expected.clone()), Ok(()));

        let result = usecase.execute(&model_id(), &gen_input()).await;

        assert_eq!(result, Ok(expected));
        // 再開では model の行を作らない
        assert_eq!(
            *log.lock().unwrap(),
            vec!["resume_training", "insert_training_run", "schedule"]
        );
        // 渡した model_id で再開し、同じ model_id に run が紐づく
        assert_eq!(*usecase.resumer.model_id.lock().unwrap(), Some(model_id()));
        assert_eq!(
            *usecase.repository.run_model_id.lock().unwrap(),
            Some(model_id())
        );
    }

    #[tokio::test]
    async fn returns_model_not_found_without_resuming() {
        let (usecase, log) = gen_usecase(
            Err(FetchModelError::NotFound("model-1".to_string())),
            Ok(JobId::new("2").unwrap()),
            Ok(()),
        );

        let result = usecase.execute(&model_id(), &gen_input()).await;

        assert!(matches!(result, Err(ResumeTrainingError::ModelNotFound(_))));
        assert!(log.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn returns_not_resumable_when_graph_is_not_saved() {
        let (usecase, log) = gen_usecase(
            Err(FetchModelError::GraphNotSaved("model-1".to_string())),
            Ok(JobId::new("2").unwrap()),
            Ok(()),
        );

        let result = usecase.execute(&model_id(), &gen_input()).await;

        assert!(matches!(result, Err(ResumeTrainingError::NotResumable(_))));
        assert!(log.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn does_not_record_when_precondition_fails() {
        let err = StartTrainingError::ResumePreconditionFailed("checkpoint not found".to_string());
        let (usecase, log) = gen_usecase(Ok(gen_config()), Err(err.clone()), Ok(()));

        let result = usecase.execute(&model_id(), &gen_input()).await;

        assert_eq!(result, Err(ResumeTrainingError::Start(err)));
        // 学習が始まっていないので、training_runs には insert しない
        assert_eq!(*log.lock().unwrap(), vec!["resume_training"]);
    }

    #[tokio::test]
    async fn returns_record_failed_when_insert_training_run_fails() {
        let (usecase, log) = gen_usecase(
            Ok(gen_config()),
            Ok(JobId::new("2").unwrap()),
            Err(RecordError::RecordFailed("db locked".to_string())),
        );

        let result = usecase.execute(&model_id(), &gen_input()).await;

        assert!(matches!(
            result,
            Err(ResumeTrainingError::Start(
                StartTrainingError::RecordFailed(_)
            ))
        ));
        // 記録できなかった run の進捗記録は始めない
        assert_eq!(
            *log.lock().unwrap(),
            vec!["resume_training", "insert_training_run"]
        );
    }
}
