use entities::training::{JobId, TrainingJobStatus};
use tonic::transport::Channel;
use usecases::training::StopTrainingError;
use usecases::training::TrainingStopper;

use super::from_proto::status_from_proto;
use crate::pb::training::v1::StopTrainingRequest as StopTrainingRequestPb;
use crate::pb::training::v1::{self as training_pb};
use tonic::Code;
use training_pb::training_service_client::TrainingServiceClient;

pub struct GrpcTrainingStopper {
    client: TrainingServiceClient<Channel>, // gRPC通信をするためのフィールド. Channel型を指定することで、
}

impl GrpcTrainingStopper {
    pub fn new(channel: Channel) -> Self {
        Self {
            client: TrainingServiceClient::new(channel),
        }
    }
}

impl TrainingStopper for GrpcTrainingStopper {
    async fn stop_training(&self, job_id: &JobId) -> Result<TrainingJobStatus, StopTrainingError> {
        // From<&JobId> を実装しているので参照のまま渡す
        let request = StopTrainingRequestPb::from(job_id);

        // 単項RPCなので、1回のawaitでレスポンスが確定する
        let response = self
            .client
            .clone()
            .stop_training(request)
            .await
            .map_err(|status| match status.code() {
                Code::NotFound => StopTrainingError::NotFound(status.to_string()),
                _ => StopTrainingError::StopOrderFailed(status.to_string()),
            })?
            .into_inner(); // StopTrainingResponse

        // StopTrainingResponse は error_message を持たないので、Failed の reason は空文字になる
        status_from_proto(response.status, "")
            .map_err(|e| StopTrainingError::InvalidResponse(e.to_string()))
    }
}
