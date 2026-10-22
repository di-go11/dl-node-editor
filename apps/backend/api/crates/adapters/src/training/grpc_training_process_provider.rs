use futures_core::Stream;
use futures_util::StreamExt; // streamの.mapメソッドを使うための拡張トレイト
use std::pin::Pin;

use entities::training::{JobId, TrainingProcess};
use tonic::transport::Channel;
use usecases::training::{TrainingProcessProvider, TrainingProcessProviderError};

use crate::pb::training::v1::StreamProgressRequest;

use crate::pb::training::v1::training_service_client::TrainingServiceClient;

pub struct GrpcTrainingProcessProvider {
    client: TrainingServiceClient<Channel>,
}

impl GrpcTrainingProcessProvider {
    pub fn new(channel: Channel) -> Self {
        Self {
            client: TrainingServiceClient::new(channel),
        }
    }
}

impl TrainingProcessProvider for GrpcTrainingProcessProvider {
    type ProgressStream =
        Pin<Box<dyn Stream<Item = Result<TrainingProcess, TrainingProcessProviderError>> + Send>>;
    async fn stream_progress(
        &self,
        job_id: &JobId,
    ) -> Result<Self::ProgressStream, TrainingProcessProviderError> {
        let request = StreamProgressRequest {
            job_id: job_id.as_str().to_string(),
        };

        // 接続の可否
        let stream = self
            .client
            .clone()
            .stream_progress(request)
            .await
            .map_err(|status| TrainingProcessProviderError::Unavailable(status.to_string()))?
            .into_inner(); //Streaming<StreamProgressResponse>
                           // 届く1件ごとの変換
        let stream = stream.map(|item| {
            let response = item
                .map_err(|status| TrainingProcessProviderError::Unavailable(status.to_string()))?; // 内側のErr
            TrainingProcess::try_from(response)
                .map_err(|e| TrainingProcessProviderError::InvalidData(e.to_string()))
            // 内側のOk /Err
        });

        Ok(Box::pin(stream)) // 外側のOk(接続に成功したらストリームを返す)
    }
}
