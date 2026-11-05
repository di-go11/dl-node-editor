use futures_core::Stream;
use futures_util::StreamExt; // streamの.mapメソッドを使うための拡張トレイト
use std::pin::Pin;

use entities::training::{JobId, TrainingProcess};
use tonic::{transport::Channel, Code, Status};
use usecases::training::{TrainingProgressProvider, TrainingProgressProviderError};

use crate::pb::training::v1::stream_progress_request::StartPosition;
use crate::pb::training::v1::StreamProgressRequest;

use crate::pb::training::v1::training_service_client::TrainingServiceClient;

// gRPCを使ったTrainingProgressProviderの実装
pub struct GrpcTrainingProgressProvider {
    client: TrainingServiceClient<Channel>,
}

impl GrpcTrainingProgressProvider {
    pub fn new(channel: Channel) -> Self {
        Self {
            client: TrainingServiceClient::new(channel),
        }
    }
}

type ProcessStream =
    Pin<Box<dyn Stream<Item = Result<TrainingProcess, TrainingProgressProviderError>> + Send>>;

impl TrainingProgressProvider for GrpcTrainingProgressProvider {
    type ProgressStream = ProcessStream;
    async fn stream_progress(
        &self,
        job_id: &JobId,
    ) -> Result<Self::ProgressStream, TrainingProgressProviderError> {
        // 履歴は読まず、最新の状態だけを受け取る
        self.open_stream(job_id, None).await
    }

    type EpochStream = ProcessStream;
    async fn stream_epoch_after(
        &self,
        job_id: &JobId,
        after_epoch: u32,
    ) -> Result<Self::EpochStream, TrainingProgressProviderError> {
        // after_epochより後のエポックを飛ばさずに全部受け取る(履歴の保存用)
        self.open_stream(job_id, Some(StartPosition::AfterEpoch(after_epoch)))
            .await
    }
}

impl GrpcTrainingProgressProvider {
    // start_positionの指定有無でC++側の送り方が変わる(None: 最新のみ / AfterEpoch: 全エポック)
    async fn open_stream(
        &self,
        job_id: &JobId,
        start_position: Option<StartPosition>,
    ) -> Result<ProcessStream, TrainingProgressProviderError> {
        let request = StreamProgressRequest {
            job_id: job_id.as_str().to_string(),
            start_position,
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
                .map_err(|e| TrainingProgressProviderError::InvalidData(e.to_string()))
            // 内側のOk /Err
        });

        Ok(Box::pin(stream)) // 外側のOk(接続に成功したらストリームを返す)
    }
}

fn provider_error_from_status(status: Status) -> TrainingProgressProviderError {
    match status.code() {
        Code::NotFound => TrainingProgressProviderError::NotFound(status.to_string()),
        _ => TrainingProgressProviderError::Unavailable(status.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_found_status_converts_to_not_found_error() {
        let error = provider_error_from_status(Status::not_found("job not found"));
        assert!(matches!(error, TrainingProgressProviderError::NotFound(_)));
    }

    #[test]
    fn other_status_converts_to_unavailable_error() {
        let error = provider_error_from_status(Status::unavailable("server down"));
        assert!(matches!(
            error,
            TrainingProgressProviderError::Unavailable(_)
        ));
    }
}

// TrainingStarterのgRPC実装
