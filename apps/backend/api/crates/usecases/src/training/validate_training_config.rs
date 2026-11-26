use super::ValidateTrainingConfigError;
use super::config::StartTrainingConfig;
use super::config_check::{ConfigCheckError, check_training_config};
use super::ports::ModelGraphValidator;
use super::read_training_record::TrainingRecordReader;
use crate::dataset::ports::DatasetFinder;

// 型パラメータの境界は、AppState の where 句と合わせるため R だけ構造体に付け、M / F は impl 側に付ける
pub struct ValidateTrainingConfig<R: TrainingRecordReader, M, F> {
    reader: R,
    // グラフの構造と形を C++ で確かめる(StartTraining と同じアダプター)
    validator: M,
    // グラフの形の検証にクラス数が要るので、dataset_id からデータセットのパスを引く
    datasets: F,
}

impl<R: TrainingRecordReader, M: ModelGraphValidator, F: DatasetFinder>
    ValidateTrainingConfig<R, M, F>
{
    pub fn new(reader: R, validator: M, datasets: F) -> Self {
        Self {
            reader,
            validator,
            datasets,
        }
    }
    // 新規学習の整合性チェック。学習開始(StartTraining)と同じ確認を、学習を始めずに行う。
    //   1. データセットが登録されているか
    //   2. 設定の値(Rust)とグラフの構造・形(C++)。違反はまとめて返す
    //   3. 同じ model_name のモデルがすでにないか
    // (学習再開は別のユースケースで、再開APIの中でmodel_idを検証する)
    pub async fn execute(
        &self,
        config: &StartTrainingConfig,
    ) -> Result<(), ValidateTrainingConfigError> {
        let dataset = self
            .datasets
            .find(&config.dataset_id)
            .await
            .map_err(|e| ValidateTrainingConfigError::DatasetReadFailed(e.to_string()))?
            .ok_or_else(|| {
                ValidateTrainingConfigError::DatasetNotFound(
                    config.dataset_id.as_str().to_string(),
                )
            })?;

        check_training_config(
            &config.to_training_config(dataset.dataset_path),
            &self.validator,
        )
        .await
        .map_err(|e| match e {
            ConfigCheckError::Invalid(violations) => {
                ValidateTrainingConfigError::InvalidConfig(violations)
            }
            ConfigCheckError::GraphCheckFailed(e) => {
                ValidateTrainingConfigError::GraphCheckFailed(e)
            }
        })?;

        let found = self
            .reader
            .find_model_id_by_name(&config.model_name)
            .await
            .map_err(|e| ValidateTrainingConfigError::ReadFailed(e.to_string()))?;
        match found {
            Some(_) => Err(ValidateTrainingConfigError::ModelNameAlreadyUsed(
                config.model_name.clone(),
            )),
            None => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ValidateTrainingConfig;
    use super::ValidateTrainingConfigError;
    use crate::dataset::error::DatasetError;
    use crate::dataset::ports::DatasetFinder;
    use crate::training::ModelGraphValidator;
    use crate::training::ModelGraphValidatorError;
    use crate::training::RecordError;
    use crate::training::StartTrainingConfig;
    use crate::training::read_training_record::TrainingRecordReader;
    use entities::dataset::{DatasetConfig, DatasetId};
    use entities::model::ModelGraph;
    use entities::model::ModelId;
    use entities::training::JobId;
    use entities::training::config::{
        DataSpec, ImageAnnotationConfig, ImageSpec, ImageTaskSpec, Loss, Optimizer,
        PascalVocConfig, SegmentationSpec,
    };
    use entities::validation::ConfigViolation;

    // グラフの中身は C++(FakeValidator)が確かめる前提なので、それ以外は最小限の値にする
    fn gen_config(model_name: &str) -> StartTrainingConfig {
        StartTrainingConfig {
            model_name: model_name.to_string(),
            model_graph: ModelGraph {
                nodes: vec![],
                outputs: vec![],
            },
            epoch: 1,
            batch: 1,
            device: "cpu".to_string(),
            dataset_id: DatasetId::new("dataset-1").unwrap(),
            optimizer: Optimizer::Sgd {
                learning_rate: 0.01,
                weight_decay: 0.0,
                momentum: 0.0,
                nesterov: false,
            },
            loss: Loss::CrossEntropy,
            seed: None,
            data_spec: DataSpec::Image(ImageSpec {
                input_width: 32,
                input_height: 32,
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

    // ValidateTrainingConfigが呼ぶのはfind_model_id_by_nameだけなので、
    // その戻り値だけを持たせる。他のメソッドは呼ばれたらテスト失敗にする
    struct FakeReader {
        result: Result<Option<ModelId>, RecordError>,
    }
    impl TrainingRecordReader for FakeReader {
        async fn find_model_id_by_name(
            &self,
            _model_name: &str,
        ) -> Result<Option<ModelId>, RecordError> {
            self.result.clone()
        }
        async fn last_saved_epoch(&self, _job_id: &JobId) -> Result<u32, RecordError> {
            unimplemented!("ValidateTrainingConfig does not call last_saved_epoch")
        }
        async fn find_running_job_ids(&self) -> Result<Vec<JobId>, RecordError> {
            unimplemented!("ValidateTrainingConfig does not call find_running_job_ids")
        }
    }

    // C++ でのグラフの検証の結果を固定で返す
    struct FakeValidator {
        result: Result<Vec<ConfigViolation>, ModelGraphValidatorError>,
    }
    impl ModelGraphValidator for FakeValidator {
        async fn validate_model_graph(
            &self,
            _model_graph: &ModelGraph,
            _data_spec: &DataSpec,
            _dataset_path: &str,
        ) -> Result<Vec<ConfigViolation>, ModelGraphValidatorError> {
            self.result.clone()
        }
    }

    struct FakeFinder {
        result: Result<Option<DatasetConfig>, DatasetError>,
    }
    impl DatasetFinder for FakeFinder {
        async fn find(
            &self,
            _dataset_id: &DatasetId,
        ) -> Result<Option<DatasetConfig>, DatasetError> {
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

    type TestUsecase = ValidateTrainingConfig<FakeReader, FakeValidator, FakeFinder>;

    // データセットはあり、グラフに問題はない前提で、名前の確認の結果だけを変える
    fn gen_usecase(reader_result: Result<Option<ModelId>, RecordError>) -> TestUsecase {
        ValidateTrainingConfig::new(
            FakeReader {
                result: reader_result,
            },
            FakeValidator { result: Ok(vec![]) },
            FakeFinder {
                result: Ok(Some(gen_dataset())),
            },
        )
    }

    fn graph_violation() -> ConfigViolation {
        ConfigViolation {
            field: "model_graph.nodes[0].inputs[0]".to_string(),
            message: "参照先のノードが存在しません: enc9".to_string(),
        }
    }

    #[tokio::test]
    async fn ok_when_model_name_is_not_used() {
        let usecase = gen_usecase(Ok(None));

        let result = usecase.execute(&gen_config("new_model")).await;

        assert_eq!(result, Ok(()));
    }

    #[tokio::test]
    async fn rejects_when_model_name_is_already_used() {
        let usecase = gen_usecase(Ok(Some(ModelId::new("model-1").unwrap())));

        let result = usecase.execute(&gen_config("used_model")).await;

        assert_eq!(
            result,
            Err(ValidateTrainingConfigError::ModelNameAlreadyUsed(
                "used_model".to_string()
            ))
        );
    }

    #[tokio::test]
    async fn returns_read_failed_when_select_fails() {
        let usecase = gen_usecase(Err(RecordError::RecordFailed("db locked".to_string())));

        let result = usecase.execute(&gen_config("any")).await;

        assert!(matches!(
            result,
            Err(ValidateTrainingConfigError::ReadFailed(_))
        ));
    }

    #[tokio::test]
    async fn returns_dataset_not_found_when_dataset_is_not_registered() {
        let mut usecase = gen_usecase(Ok(None));
        usecase.datasets = FakeFinder { result: Ok(None) };

        let result = usecase.execute(&gen_config("any")).await;

        assert_eq!(
            result,
            Err(ValidateTrainingConfigError::DatasetNotFound(
                "dataset-1".to_string()
            ))
        );
    }

    #[tokio::test]
    async fn returns_dataset_read_failed_when_finder_fails() {
        let mut usecase = gen_usecase(Ok(None));
        usecase.datasets = FakeFinder {
            result: Err(DatasetError::ReadFailed("db locked".to_string())),
        };

        let result = usecase.execute(&gen_config("any")).await;

        assert!(matches!(
            result,
            Err(ValidateTrainingConfigError::DatasetReadFailed(_))
        ));
    }

    #[tokio::test]
    async fn returns_graph_violations_from_engine() {
        let mut usecase = gen_usecase(Ok(None));
        usecase.validator = FakeValidator {
            result: Ok(vec![graph_violation()]),
        };

        let result = usecase.execute(&gen_config("new_model")).await;

        assert_eq!(
            result,
            Err(ValidateTrainingConfigError::InvalidConfig(vec![
                graph_violation()
            ]))
        );
    }

    #[tokio::test]
    async fn returns_value_and_graph_violations_together() {
        let mut usecase = gen_usecase(Ok(None));
        usecase.validator = FakeValidator {
            result: Ok(vec![graph_violation()]),
        };
        let mut config = gen_config("new_model");
        config.batch = 0;

        let result = usecase.execute(&config).await;

        let Err(ValidateTrainingConfigError::InvalidConfig(violations)) = &result else {
            panic!("InvalidConfig になるはず: {result:?}");
        };
        let fields: Vec<&str> = violations.iter().map(|v| v.field.as_str()).collect();
        assert_eq!(fields, vec!["batch", "model_graph.nodes[0].inputs[0]"]);
    }

    #[tokio::test]
    async fn returns_graph_check_failed_when_validator_cannot_check() {
        let mut usecase = gen_usecase(Ok(None));
        let err = ModelGraphValidatorError::DatasetUnreadable("labelmap.txt".to_string());
        usecase.validator = FakeValidator {
            result: Err(err.clone()),
        };

        let result = usecase.execute(&gen_config("new_model")).await;

        assert_eq!(result, Err(ValidateTrainingConfigError::GraphCheckFailed(err)));
    }
}
