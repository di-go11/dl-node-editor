use crate::training::ProgressRecordingScheduler;

use super::ModelIdGenerator;
use super::TrainingRunRegistar;
use super::TrainingStarter;
use super::config::StartTrainingConfig;
use super::config_check::{ConfigCheckError, check_training_config};
use super::error::StartTrainingError;
use super::ports::ModelGraphValidator;
use crate::dataset::ports::DatasetFinder;
use entities::model::ModelId;
use entities::training::JobId;

pub struct StartTraining<S, R, G, K, F> {
    // 学習の開始に加えて、開始前のグラフの検証(ModelGraphValidator)にも使う。
    // どちらも学習エンジン(C++)への依頼なので、同じアダプター(GrpcTrainingStarter)が両方を実装する
    starter: S,
    repository: R,
    id_generator: G,
    scheduler: K,
    // クライアントが選んだ dataset_id から、C++ に送るデータセットのパスを引く
    datasets: F,
}

impl<
    S: TrainingStarter + ModelGraphValidator,
    R: TrainingRunRegistar,
    G: ModelIdGenerator,
    K: ProgressRecordingScheduler,
    F: DatasetFinder,
> StartTraining<S, R, G, K, F>
{
    pub fn new(starter: S, repository: R, id_generator: G, scheduler: K, datasets: F) -> Self {
        Self {
            starter,
            repository,
            id_generator,
            scheduler,
            datasets,
        }
    }
    // 新規学習を開始する(学習再開は別のユースケースにする)。
    // C++開始後にinsert_training_runが失敗した場合、C++は走り続ける(issue 作業8)。
    pub async fn execute(&self, input: &StartTrainingConfig) -> Result<JobId, StartTrainingError> {
        // データセットを最初に確認する。存在しない ID なら、model の行を作る前に断る
        let dataset = self
            .datasets
            .find(&input.dataset_id)
            .await
            .map_err(|e| StartTrainingError::DatasetReadFailed(e.to_string()))?
            .ok_or_else(|| {
                StartTrainingError::DatasetNotFound(input.dataset_id.as_str().to_string())
            })?;
        let config = &input.to_training_config(dataset.dataset_path);
        // 設定にミスが無いか確認。ある場合すべてのエラーをGUIに送る。
        // 値(Rust)とグラフ(C++)の両方を、model の行を作る前に確かめる
        check_training_config(config, &self.starter)
            .await
            .map_err(|e| match e {
                ConfigCheckError::Invalid(violations) => {
                    StartTrainingError::InvalidConfig(violations)
                }
                ConfigCheckError::GraphCheckFailed(e) => StartTrainingError::GraphCheckFailed(e),
            })?;
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
    use super::ModelGraphValidator;
    use super::ModelIdGenerator;
    use super::StartTraining;
    use super::StartTrainingError;
    use super::TrainingRunRegistar;
    use super::TrainingStarter;
    use crate::dataset::error::DatasetError;
    use crate::training::ModelGraphValidatorError;
    use entities::validation::ConfigViolation;
    use crate::dataset::ports::DatasetFinder;
    use crate::training::ProgressRecordingScheduler;
    use crate::training::RecordError;
    use crate::training::StartTrainingConfig;
    use entities::dataset::{DatasetConfig, DatasetId};
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

    fn gen_normal_order() -> StartTrainingConfig {
        StartTrainingConfig {
            model_name: "test_model".to_string(),
            model_graph: gen_model_graph(),
            epoch: 1,
            batch: 2,
            device: "cpu".to_string(),
            dataset_id: DatasetId::new("dataset-1").unwrap(),
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
            save_last_every: 0,
        }
    }
    // 呼び出された順番を記録する。starterとrepositoryで共有して、呼び出し順を確認する
    type CallLog = Arc<Mutex<Vec<&'static str>>>;

    struct FakeStarter {
        result: Result<JobId, StartTrainingError>,
        log: CallLog,
        // C++ に送られた学習設定(データセットのパスが ID から引いた値になっているかを確認する)
        sent_config: Mutex<Option<TrainingConfig>>,
        // C++ でのグラフの検証の結果(既定は問題なし)
        graph_result: Result<Vec<ConfigViolation>, ModelGraphValidatorError>,
        // グラフの検証に渡されたデータセットのパス
        graph_dataset_path: Mutex<Option<String>>,
    }
    impl ModelGraphValidator for FakeStarter {
        async fn validate_model_graph(
            &self,
            _model_graph: &ModelGraph,
            _data_spec: &DataSpec,
            dataset_path: &str,
        ) -> Result<Vec<ConfigViolation>, ModelGraphValidatorError> {
            self.log.lock().unwrap().push("validate_model_graph");
            *self.graph_dataset_path.lock().unwrap() = Some(dataset_path.to_string());
            self.graph_result.clone()
        }
    }
    impl TrainingStarter for FakeStarter {
        async fn start_training(
            &self,
            training_config: &TrainingConfig,
            _model_id: &ModelId,
        ) -> Result<JobId, StartTrainingError> {
            self.log.lock().unwrap().push("start_training");
            *self.sent_config.lock().unwrap() = Some(training_config.clone());
            self.result.clone() // &self なので clone して返す(JobId も StartTrainingError も Clone 可)
        }
    }

    // 登録済みデータセットの検索結果を固定で返す
    struct FakeFinder {
        result: Result<Option<DatasetConfig>, DatasetError>,
        log: CallLog,
    }
    impl DatasetFinder for FakeFinder {
        async fn find(
            &self,
            _dataset_id: &DatasetId,
        ) -> Result<Option<DatasetConfig>, DatasetError> {
            self.log.lock().unwrap().push("find_dataset");
            self.result.clone()
        }
    }

    fn gen_dataset() -> DatasetConfig {
        DatasetConfig {
            dataset_id: DatasetId::new("dataset-1").unwrap(),
            dataset_name: "voc2012".to_string(),
            dataset_type: "pascal_voc".to_string(),
            dataset_path: "/datasets/dataset-1".to_string(),
            created_at: "2026-11-17T00:00:00Z".to_string(),
            updated_at: None,
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
        fn schedule(&self, job_id: JobId) {
            self.job_ids.lock().unwrap().push(job_id);
        }
    }

    type TestUsecase =
        StartTraining<FakeStarter, FakeRepository, FakeIdGenerator, FakeScheduler, FakeFinder>;

    // データセットは見つかる前提で、C++ の開始と DB への記録の結果だけを変える
    fn gen_usecase(
        start_result: Result<JobId, StartTrainingError>,
        insert_model_result: Result<(), RecordError>,
        insert_training_run_result: Result<(), RecordError>,
    ) -> (TestUsecase, CallLog) {
        gen_usecase_with_dataset(
            Ok(Some(gen_dataset())),
            start_result,
            insert_model_result,
            insert_training_run_result,
        )
    }

    fn gen_usecase_with_dataset(
        find_result: Result<Option<DatasetConfig>, DatasetError>,
        start_result: Result<JobId, StartTrainingError>,
        insert_model_result: Result<(), RecordError>,
        insert_training_run_result: Result<(), RecordError>,
    ) -> (TestUsecase, CallLog) {
        let log = CallLog::default();
        let usecase = StartTraining::new(
            FakeStarter {
                result: start_result,
                log: Arc::clone(&log),
                sent_config: Mutex::new(None),
                graph_result: Ok(vec![]),
                graph_dataset_path: Mutex::new(None),
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
            FakeFinder {
                result: find_result,
                log: Arc::clone(&log),
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
        // データセットを最初に確認し、次にグラフを C++ で確かめる。
        // modelはtraining_runsから外部キーで参照されるため、その次にinsertされる
        assert_eq!(
            *log.lock().unwrap(),
            vec![
                "find_dataset",
                "validate_model_graph",
                "insert_model",
                "start_training",
                "insert_training_run"
            ]
        );
        // 新規学習では生成したmodel_idが紐づく
        assert_eq!(
            *usecase.repository.run_model_id.lock().unwrap(),
            Some(ModelId::new("model-1").unwrap())
        );
    }

    #[tokio::test]
    async fn sends_dataset_path_found_by_id() {
        let (usecase, _log) = gen_usecase(Ok(JobId::new("1").unwrap()), Ok(()), Ok(()));

        usecase.execute(&gen_normal_order()).await.unwrap();

        // C++ には、クライアントが送った ID ではなく、DB に登録されたパスが届く
        let sent = usecase.starter.sent_config.lock().unwrap().clone().unwrap();
        assert_eq!(sent.dataset_path, "/datasets/dataset-1");
    }

    #[tokio::test]
    async fn returns_dataset_not_found_when_dataset_is_not_registered() {
        let (usecase, log) =
            gen_usecase_with_dataset(Ok(None), Ok(JobId::new("1").unwrap()), Ok(()), Ok(()));

        let result = usecase.execute(&gen_normal_order()).await;

        assert_eq!(
            result,
            Err(StartTrainingError::DatasetNotFound("dataset-1".to_string()))
        );
        // modelの行も作らず、C++にも送らない
        assert_eq!(*log.lock().unwrap(), vec!["find_dataset"]);
    }

    #[tokio::test]
    async fn returns_dataset_read_failed_when_finder_fails() {
        let (usecase, log) = gen_usecase_with_dataset(
            Err(DatasetError::ReadFailed("db locked".to_string())),
            Ok(JobId::new("1").unwrap()),
            Ok(()),
            Ok(()),
        );

        let result = usecase.execute(&gen_normal_order()).await;

        assert!(matches!(
            result,
            Err(StartTrainingError::DatasetReadFailed(_))
        ));
        assert_eq!(*log.lock().unwrap(), vec!["find_dataset"]);
    }

    #[tokio::test]
    async fn returns_error_when_start_fails() {
        let err = StartTrainingError::StartOrderFailed("server down".to_string());
        let (usecase, log) = gen_usecase(Err(err.clone()), Ok(()), Ok(()));

        let result = usecase.execute(&gen_normal_order()).await;

        assert_eq!(result, Err(err));
        // 学習が始まっていないので、training_runsにはinsertしない
        assert_eq!(
            *log.lock().unwrap(),
            vec![
                "find_dataset",
                "validate_model_graph",
                "insert_model",
                "start_training"
            ]
        );
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
        assert_eq!(
            *log.lock().unwrap(),
            vec!["find_dataset", "validate_model_graph", "insert_model"]
        );
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

    fn graph_violation() -> ConfigViolation {
        ConfigViolation {
            field: "model_graph.nodes[2]".to_string(),
            message: "ポート 'y': モデルの出力のチャンネル数(3)が、クラス数(21)と一致しません"
                .to_string(),
        }
    }

    fn violated_fields(result: &Result<JobId, StartTrainingError>) -> Vec<String> {
        match result {
            Err(StartTrainingError::InvalidConfig(violations)) => {
                violations.iter().map(|v| v.field.clone()).collect()
            }
            other => panic!("InvalidConfig になるはず: {other:?}"),
        }
    }

    #[tokio::test]
    async fn graph_check_receives_dataset_path_found_by_id() {
        let (usecase, _log) = gen_usecase(Ok(JobId::new("1").unwrap()), Ok(()), Ok(()));

        usecase.execute(&gen_normal_order()).await.unwrap();

        // C++ がクラス数を求めるのに使うパスも、DB に登録されたパス
        assert_eq!(
            *usecase.starter.graph_dataset_path.lock().unwrap(),
            Some("/datasets/dataset-1".to_string())
        );
    }

    #[tokio::test]
    async fn returns_graph_violations_without_inserting_model() {
        let (mut usecase, log) = gen_usecase(Ok(JobId::new("1").unwrap()), Ok(()), Ok(()));
        usecase.starter.graph_result = Ok(vec![graph_violation()]);

        let result = usecase.execute(&gen_normal_order()).await;

        assert_eq!(
            result,
            Err(StartTrainingError::InvalidConfig(vec![graph_violation()]))
        );
        // model の行は作らず、学習も始めない(値を直せば同じ名前で送り直せる)
        assert_eq!(
            *log.lock().unwrap(),
            vec!["find_dataset", "validate_model_graph"]
        );
    }

    #[tokio::test]
    async fn returns_value_and_graph_violations_together() {
        let (mut usecase, _log) = gen_usecase(Ok(JobId::new("1").unwrap()), Ok(()), Ok(()));
        usecase.starter.graph_result = Ok(vec![graph_violation()]);
        let mut order = gen_normal_order();
        order.optimizer = Optimizer::Adam {
            learning_rate: 0.0,
            weight_decay: 0.0,
            beta1: 0.9,
            beta2: 0.999,
            eps: 1e-8,
        };

        let result = usecase.execute(&order).await;

        // グラフ以外の値の違反だけなら C++ も呼び、両方を 1 つの一覧で返す
        assert_eq!(
            violated_fields(&result),
            vec!["optimizer.learning_rate", "model_graph.nodes[2]"]
        );
    }

    #[tokio::test]
    async fn does_not_call_graph_check_when_layer_params_are_invalid() {
        let (mut usecase, log) = gen_usecase(Ok(JobId::new("1").unwrap()), Ok(()), Ok(()));
        usecase.starter.graph_result = Ok(vec![graph_violation()]);
        let mut order = gen_normal_order();
        if let NodeSpec::Conv2D(conv) = &mut order.model_graph.nodes[0].spec {
            conv.stride = 0;
        }

        let result = usecase.execute(&order).await;

        // 層のパラメータが不正だと C++ はグラフを受け取れない(INVALID_ARGUMENT)ので呼ばない
        assert_eq!(
            violated_fields(&result),
            vec!["model_graph.nodes[0].spec.stride"]
        );
        assert_eq!(*log.lock().unwrap(), vec!["find_dataset"]);
    }

    #[tokio::test]
    async fn returns_graph_check_failed_when_validator_cannot_check() {
        let (mut usecase, log) = gen_usecase(Ok(JobId::new("1").unwrap()), Ok(()), Ok(()));
        let err = ModelGraphValidatorError::CallFailed("server down".to_string());
        usecase.starter.graph_result = Err(err.clone());

        let result = usecase.execute(&gen_normal_order()).await;

        assert_eq!(result, Err(StartTrainingError::GraphCheckFailed(err)));
        assert_eq!(
            *log.lock().unwrap(),
            vec!["find_dataset", "validate_model_graph"]
        );
    }
}
