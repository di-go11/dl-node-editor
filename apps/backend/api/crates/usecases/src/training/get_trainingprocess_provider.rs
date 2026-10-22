use entities::training::TrainingProcess;

use super::{TrainingProcessProvider, TrainingProcessProviderError};

pub struct GetTrainingProcess<P: TrainingProcessProvider> {
    provider: P,
}

impl<P: TrainingProcessProvider> GetTrainingProcess<P> {
    pub fn new(provider: P) -> Self {
        Self { provider }
    }

    pub async fn execute(&self) -> Result<TrainingProcess, TrainingProcessProviderError> {
        self.provider.fetch().await
    }
}

#[cfg(test)]

mod tests {
    use std::time::Duration;

    use entities::training::{Metrics, SegmentationMetrics, TrainingJobStatus};

    use super::*;

    // テスト用の偽Provider。 c++サーバーを必要としない。
    // TrainingPRocessProviderを実装した偽物
    struct FakeProvider {
        result: Result<TrainingProcess, TrainingProcessProviderError>,
    }

    impl TrainingProcessProvider for FakeProvider {
        async fn fetch(&self) -> Result<TrainingProcess, TrainingProcessProviderError> {
            self.result.clone() // resultは参照値. 戻り値では実値を求めているが、参照のままでは返せない。そのため、clone()をつかってコピーをかける。
            // 必須事項. TrainingProcessとTrainingProcessProviderErrorにCloneのアトリビュートを付ける。
        }
    }
    fn running_status_good() -> TrainingProcess {
        TrainingProcess {
            epoch: 1,
            train_loss: 0.2,
            val_loss: 0.3,
            status: TrainingJobStatus::Running,
            metrics: Some(Metrics::Segmentation(SegmentationMetrics {
                pixel_accuracy: 0.9,
                miou: 0.7,
                fw_iou: 0.8,
                mean_class_accuracy: 0.75,
                per_class_accuracy: vec![0.95, 0.6, 0.7],
            })),
            epoch_elapsed_time: Duration::from_secs(10),
            total_elapsed_time: Duration::from_secs(10),
        }
    }

    fn server_unavailable() -> TrainingProcessProviderError {
        let errormessage: String = "TimeOut".to_string();
        TrainingProcessProviderError::Unavailable(errormessage)
    }
    #[tokio::test] //tokioが1つのランタイムを作り,中の.awaitを実行する。

    async fn returns_trainingprocess_from_provider_o() {
        let usecase = GetTrainingProcess::new(FakeProvider {
            result: Ok(running_status_good()),
        });
        let result = usecase.execute().await;
        assert_eq!(result, Ok(running_status_good()));
    }

    #[tokio::test]
    async fn returns_trainingprocess_from_provider_e() {
        let usecase = GetTrainingProcess::new(FakeProvider {
            result: Err(server_unavailable()),
        });
        let result = usecase.execute().await;
        assert_eq!(result, Err(server_unavailable()));
    }
}
