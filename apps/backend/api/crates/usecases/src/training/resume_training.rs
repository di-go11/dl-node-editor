use super::ProgressRecordingScheduler;
use super::TrainingResumer;
use super::TrainingRunRegistar;
use super::error::{ResumeTrainingError, StartTrainingError};
use crate::model::error::FetchModelError;
use crate::model::ports::ModelTrainingConfigProvider;
use entities::model::ModelId;
use entities::training::JobId;
use entities::training::config::TrainingConfig;

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
        config: &TrainingConfig,
    ) -> Result<JobId, ResumeTrainingError> {
        // モデルと前回の学習設定があるかを確かめる
        // TODO: 固定項目(model_name / model_graph / data_spec / Optimizer の種類)は、
        //       今はフロントで読み取り専用にしているだけ。ここで取得した値で上書き・照合する(issue doc 作業5)。
        let _saved = self.config.fetch(model_id).await.map_err(|e| match e {
            FetchModelError::NotFound(msg) => ResumeTrainingError::ModelNotFound(msg),
            FetchModelError::GraphNotSaved(msg) => ResumeTrainingError::NotResumable(msg),
            FetchModelError::InvalidQuery(msg) | FetchModelError::InvalidData(msg) => {
                ResumeTrainingError::ReadFailed(msg)
            }
        })?;

        let job_id = self.resumer.resume_training(config, model_id).await?;
        // 再開では model の行は作らず、同じ model_id に新しい run を追加する
        self.repository
            .insert_training_run(&job_id, config, model_id)
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
        PascalVocConfig, SegmentationSpec,
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
    }
    impl TrainingResumer for FakeResumer {
        async fn resume_training(
            &self,
            _training_config: &TrainingConfig,
            model_id: &ModelId,
        ) -> Result<JobId, StartTrainingError> {
            self.log.lock().unwrap().push("resume_training");
            *self.model_id.lock().unwrap() = Some(model_id.clone());
            self.result.clone()
        }
    }

    struct FakeRepository {
        insert_training_run_result: Result<(), RecordError>,
        log: CallLog,
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
            Ok(())
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
            },
            FakeRepository {
                insert_training_run_result,
                log: Arc::clone(&log),
                run_model_id: Mutex::new(None),
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

    #[tokio::test]
    async fn resumes_with_given_model_id_without_inserting_model() {
        let expected = JobId::new("2").unwrap();
        let (usecase, log) = gen_usecase(Ok(gen_config()), Ok(expected.clone()), Ok(()));

        let result = usecase.execute(&model_id(), &gen_config()).await;

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

        let result = usecase.execute(&model_id(), &gen_config()).await;

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

        let result = usecase.execute(&model_id(), &gen_config()).await;

        assert!(matches!(result, Err(ResumeTrainingError::NotResumable(_))));
        assert!(log.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn does_not_record_when_precondition_fails() {
        let err = StartTrainingError::ResumePreconditionFailed("checkpoint not found".to_string());
        let (usecase, log) = gen_usecase(Ok(gen_config()), Err(err.clone()), Ok(()));

        let result = usecase.execute(&model_id(), &gen_config()).await;

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

        let result = usecase.execute(&model_id(), &gen_config()).await;

        assert!(matches!(
            result,
            Err(ResumeTrainingError::Start(StartTrainingError::RecordFailed(_)))
        ));
        // 記録できなかった run の進捗記録は始めない
        assert_eq!(
            *log.lock().unwrap(),
            vec!["resume_training", "insert_training_run"]
        );
    }
}
