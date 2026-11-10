use super::error::TrainingProgressProviderError;
use entities::training::JobId;
use entities::training::TrainingProcess;
use futures_core::Stream;
// 学習の「最新の状態」だけを受け取るためのポート(HTTPの状態取得・SSE用)。
// 待っている間に複数の更新があった場合、途中の更新は飛ばされる。
pub trait TrainingProgressProvider {
    type ProgressStream: Stream<Item = Result<TrainingProcess, TrainingProgressProviderError>>
        + Send; // c++から何度も届く通信(Stream) ItemはStreamが持つ関連型で通信で届く1件ごとの型をvariantなどで決めることができる今回のように。
    // Sendはその値を別スレッドに移しても安全であるということを示す。c++では原則スレッド内のものを移すことは禁止だったがこっちではOK
    // typeはエイリアスみたいなもの. このtraitを実装しているものでその型が定義される、
    fn stream_progress(
        &self,
        job_id: &JobId,
    ) -> impl Future<Output = Result<Self::ProgressStream, TrainingProgressProviderError>> + Send; // C++サーバーとのストリームを開くための関数(一回の通信だからFuture) OutputはFutureによる何らかのアクションで届く値こっちもvariantで動的に決めることができる。
    // Straem<Item=Result<TrainingProcess,TrainingProgressProviderError>>+Sendを満たす何らかの型を実装側が決める。
    type EpochStream: Stream<Item = Result<TrainingProcess, TrainingProgressProviderError>> + Send;
    fn stream_epoch_after(
        &self,
        job_id: &JobId,
        after_epoch: u32,
    ) -> impl Future<Output = Result<Self::EpochStream, TrainingProgressProviderError>> + Send;
}

pub struct GetTrainingProcess<P: TrainingProgressProvider> {
    provider: P,
}

impl<P: TrainingProgressProvider> GetTrainingProcess<P> {
    pub fn new(provider: P) -> Self {
        Self { provider }
    }

    pub async fn execute(
        &self,
        job_id: &JobId,
    ) -> Result<P::ProgressStream, TrainingProgressProviderError> {
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
    // TrainingProgressProviderを実装した偽物
    struct FakeProvider {
        result: Result<
            Vec<Result<TrainingProcess, TrainingProgressProviderError>>,
            TrainingProgressProviderError,
        >,
    }

    impl TrainingProgressProvider for FakeProvider {
        type ProgressStream = futures_util::stream::Iter<
            std::vec::IntoIter<Result<TrainingProcess, TrainingProgressProviderError>>,
        >;
        async fn stream_progress(
            &self,
            _job_id: &JobId,
        ) -> Result<Self::ProgressStream, TrainingProgressProviderError> {
            self.result.clone().map(futures_util::stream::iter)
        }
        type EpochStream = futures_util::stream::Iter<
            std::vec::IntoIter<Result<TrainingProcess, TrainingProgressProviderError>>,
        >;
        async fn stream_epoch_after(
            &self,
            _job_id: &JobId,
            _after_epoch: u32,
        ) -> Result<Self::EpochStream, TrainingProgressProviderError> {
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

    fn server_unavailable() -> TrainingProgressProviderError {
        let errormessage: String = "TimeOut".to_string();
        TrainingProgressProviderError::Unavailable(errormessage)
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
