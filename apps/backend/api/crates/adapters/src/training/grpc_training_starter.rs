use entities::training::ModelId;
use entities::training::{config::TrainingConfig, JobId};
use tonic::{transport::Channel, Code, Status};
use usecases::training::StartTrainingError;
use usecases::training::{ModelIdGenerator, TrainingStarter};

use crate::pb::training::v1::StartTrainingRequest as StartTrainingRequestPb;
use crate::pb::training::v1::{self as training_pb};
use training_pb::training_service_client::TrainingServiceClient;

pub struct GrpcTrainingStarter {
    client: TrainingServiceClient<Channel>, // gRPC通信をするためのフィールド. Channel型を指定することで、
}

impl GrpcTrainingStarter {
    pub fn new(channel: Channel) -> Self {
        Self {
            client: TrainingServiceClient::new(channel),
        }
    }
}

impl TrainingStarter for GrpcTrainingStarter {
    async fn start_training(
        &self,
        training_config: &TrainingConfig,
    ) -> Result<JobId, StartTrainingError> {
        // From<&TrainingConfig> を実装しているので参照のまま渡す
        let request = StartTrainingRequestPb::from(training_config);

        // 単項RPCなので、1回のawaitでレスポンスが確定する
        let response = self
            .client
            .clone()
            .start_training(request)
            .await
            .map_err(start_error_from_status)?
            .into_inner(); // StartTrainingResponse

        // proto の String をドメインの JobId に変換(空文字列ならエラー)
        JobId::new(response.job_id).map_err(|e| StartTrainingError::StartOrderFailed(e.to_string()))
    }
}

fn start_error_from_status(status: Status) -> StartTrainingError {
    match status.code() {
        Code::FailedPrecondition => StartTrainingError::AlreadyRunning(status.to_string()),
        Code::InvalidArgument => StartTrainingError::InvalidConfig(status.to_string()),
        _ => StartTrainingError::StartOrderFailed(status.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_precondition_status_converts_to_already_running_error() {
        let error = start_error_from_status(Status::failed_precondition("job is running"));
        assert!(matches!(error, StartTrainingError::AlreadyRunning(_)));
    }

    #[test]
    fn invalid_argument_status_converts_to_invalid_config_error() {
        let error = start_error_from_status(Status::invalid_argument("bad graph"));
        assert!(matches!(error, StartTrainingError::InvalidConfig(_)));
    }

    #[test]
    fn other_status_converts_to_start_order_failed_error() {
        let error = start_error_from_status(Status::unavailable("server down"));
        assert!(matches!(error, StartTrainingError::StartOrderFailed(_)));
    }
}
