use super::ValidateTrainingConfigError;
use super::read_training_record::TrainingRecordReader;
use entities::training::config::TrainingConfig;

pub struct ValidateTrainingConfig<R: TrainingRecordReader> {
    reader: R,
}

impl<R: TrainingRecordReader> ValidateTrainingConfig<R> {
    pub fn new(reader: R) -> Self {
        Self { reader }
    }
    // 新規学習の整合性チェック: 同じmodel_nameのモデルがすでにあればNG
    // TODO: Resumeのチェックは後で実装する(TrainingModeKindを受け取る形にする)
    pub async fn execute(&self, config: &TrainingConfig) -> Result<(), ValidateTrainingConfigError> {
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
    use crate::training::RepositoryError;
    use crate::training::read_training_record::TrainingRecordReader;
    use entities::model::ModelGraph;
    use entities::training::ModelId;
    use entities::training::config::{
        DataSpec, ImageAnnotationConfig, ImageSpec, ImageTaskSpec, Loss, Optimizer,
        PascalVocConfig, SegmentationSpec, TrainingConfig,
    };

    // チェックではmodel_nameしか使わないため、それ以外は最小限の値にする
    fn gen_config(model_name: &str) -> TrainingConfig {
        TrainingConfig {
            model_name: model_name.to_string(),
            model_graph: ModelGraph {
                nodes: vec![],
                outputs: vec![],
            },
            epoch: 1,
            batch: 1,
            device: "cpu".to_string(),
            dataset_path: "/data".to_string(),
            optimizer: Optimizer::Sgd {
                learning_rate: 0.01,
                weight_decay: 0.0,
                momentum: 0.0,
                nesterov: false,
            },
            loss: Loss::CrossEntropy,
            resume_from: None,
            seed: None,
            data_spec: DataSpec::Image(ImageSpec {
                input_width: 32,
                input_height: 32,
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

    struct FakeReader {
        result: Result<Option<ModelId>, RepositoryError>,
    }
    impl TrainingRecordReader for FakeReader {
        async fn find_model_id_by_name(
            &self,
            _model_name: &str,
        ) -> Result<Option<ModelId>, RepositoryError> {
            self.result.clone()
        }
    }

    #[tokio::test]
    async fn ok_when_model_name_is_not_used() {
        let usecase = ValidateTrainingConfig::new(FakeReader { result: Ok(None) });

        let result = usecase.execute(&gen_config("new_model")).await;

        assert_eq!(result, Ok(()));
    }

    #[tokio::test]
    async fn rejects_when_model_name_is_already_used() {
        let usecase = ValidateTrainingConfig::new(FakeReader {
            result: Ok(Some(ModelId::new("model-1").unwrap())),
        });

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
        let usecase = ValidateTrainingConfig::new(FakeReader {
            result: Err(RepositoryError::QueryFailed("db locked".to_string())),
        });

        let result = usecase.execute(&gen_config("any")).await;

        assert!(matches!(result, Err(ValidateTrainingConfigError::ReadFailed(_))));
    }
}
