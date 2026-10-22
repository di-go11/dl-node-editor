use entities::training::JobId;

use super::{TrainingProcessProvider, TrainingProcessProviderError};

pub struct GetTrainingProcess<P: TrainingProcessProvider> {
    provider: P,
}

impl<P: TrainingProcessProvider> GetTrainingProcess<P> {
    pub fn new(provider: P) -> Self {
        Self { provider }
    }

    pub async fn execute(
        &self,
        job_id: &JobId,
    ) -> Result<P::ProgressStream, TrainingProcessProviderError> {
        self.provider.stream_progress(job_id).await
    }
}

#[cfg(test)]
mod tests {
    use entities::training::{
        JobId, Metrics, SegmentationMetrics, TrainingJobStatus, TrainingProcess,
    };
    use futures_util::StreamExt;
    use std::{assert_eq, time::Duration};

    use super::*;

    // テスト用の偽Provider。 c++サーバーを必要としない。
    // TrainingPRocessProviderを実装した偽物
    struct FakeProvider {
        result: Result<
            Vec<Result<TrainingProcess, TrainingProcessProviderError>>,
            TrainingProcessProviderError,
        >,
    }

    impl TrainingProcessProvider for FakeProvider {
        type ProgressStream = futures_util::stream::Iter<
            std::vec::IntoIter<Result<TrainingProcess, TrainingProcessProviderError>>,
        >;
        async fn stream_progress(
            &self,
            _job_id: &JobId,
        ) -> Result<Self::ProgressStream, TrainingProcessProviderError> {
            self.result.clone().map(futures_util::stream::iter)
        }
    }
    fn job_id() -> JobId {
        JobId::new("1").unwrap()
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
                per_class_iou: vec![0.95, 0.6, 0.7],
            })),
            epoch_elapsed_time: Duration::from_secs(10),
            total_elapsed_time: Duration::from_secs(10),
        }
    }

    fn server_unavailable() -> TrainingProcessProviderError {
        let errormessage: String = "TimeOut".to_string();
        TrainingProcessProviderError::Unavailable(errormessage)
    }

    fn running_status_epoch2() -> TrainingProcess {
        TrainingProcess {
            epoch: 2,
            train_loss: 0.2,
            val_loss: 0.3,
            status: TrainingJobStatus::Running,
            metrics: Some(Metrics::Segmentation(SegmentationMetrics {
                pixel_accuracy: 0.9,
                miou: 0.7,
                fw_iou: 0.8,
                mean_class_accuracy: 0.75,
                per_class_iou: vec![0.95, 0.6, 0.7],
            })),
            epoch_elapsed_time: Duration::from_secs(10),
            total_elapsed_time: Duration::from_secs(10),
        }
    }
    #[tokio::test] //tokioが1つのランタイムを作り,中の.awaitを実行する。

    async fn returns_trainingprocess_from_provider() {
        let usecase = GetTrainingProcess::new(FakeProvider {
            result: Ok(vec![Ok(running_status_good())]),
        });
        let stream = usecase.execute(&job_id()).await.unwrap(); // 外側にあるResultを展開して中のストリームを取り出す。
        let items: Vec<_> = stream.collect().await;
        assert_eq!(items, vec![Ok(running_status_good())]);
    }

    #[tokio::test]
    async fn return_error_when_provider_is_unavailable() {
        let usecase = GetTrainingProcess::new(FakeProvider {
            result: Err(server_unavailable()),
        });
        let result = usecase.execute(&job_id()).await;
        assert_eq!(result.err(), Some(server_unavailable()));
    }

    #[tokio::test]
    async fn passes_through_error_in_the_middle_of_stream() {
        let usecase = GetTrainingProcess::new(FakeProvider {
            result: Ok(vec![
                Ok(running_status_good()),
                Ok(running_status_epoch2()),
                Err(server_unavailable()),
            ]),
        });
        let stream = usecase.execute(&job_id()).await.unwrap();
        let items: Vec<_> = stream.collect().await;
        assert_eq!(
            items,
            vec![
                Ok(running_status_good()),
                Ok(running_status_epoch2()),
                Err(server_unavailable()),
            ]
        );
    }
}
