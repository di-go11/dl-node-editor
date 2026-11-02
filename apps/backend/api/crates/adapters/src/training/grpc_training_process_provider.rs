use futures_core::Stream;
use futures_util::StreamExt; // streamの.mapメソッドを使うための拡張トレイト
use std::pin::Pin;

use entities::training::{JobId, TrainingProcess};
use tonic::{transport::Channel, Code, Status};
use usecases::training::{TrainingProcessProvider, TrainingProcessProviderError};

use crate::pb::training::v1::StreamProgressRequest;

use crate::pb::training::v1::training_service_client::TrainingServiceClient;

// gRPCを使ったTrainingProcessProviderの実装
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
            .map_err(provider_error_from_status)?
            .into_inner(); //Streaming<StreamProgressResponse>
                           // 届く1件ごとの変換
        let stream = stream.map(|item| {
            let response = item.map_err(provider_error_from_status)?; // 内側のErr
            TrainingProcess::try_from(response)
                .map_err(|e| TrainingProcessProviderError::InvalidData(e.to_string()))
            // 内側のOk /Err
        });

        Ok(Box::pin(stream)) // 外側のOk(接続に成功したらストリームを返す)
    }
}

fn provider_error_from_status(status: Status) -> TrainingProcessProviderError {
    match status.code() {
        Code::NotFound => TrainingProcessProviderError::NotFound(status.to_string()),
        _ => TrainingProcessProviderError::Unavailable(status.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_found_status_converts_to_not_found_error() {
        let error = provider_error_from_status(Status::not_found("job not found"));
        assert!(matches!(error, TrainingProcessProviderError::NotFound(_)));
    }

    #[test]
    fn other_status_converts_to_unavailable_error() {
        let error = provider_error_from_status(Status::unavailable("server down"));
        assert!(matches!(
            error,
            TrainingProcessProviderError::Unavailable(_)
        ));
    }
}

// TrainingStarterのgRPC実装
