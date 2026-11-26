use entities::{
    model::ModelId,
    training::{config::TrainingConfig, JobId},
};
use tonic::{transport::Channel, Code, Status};
use usecases::training::StartTrainingError;
use usecases::training::{TrainingResumer, TrainingStarter};

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
    async fn send(
        &self,
        config: &TrainingConfig,
        model_id: &ModelId,
        resume: bool,
    ) -> Result<JobId, StartTrainingError> {
        let mut request = StartTrainingRequestPb::from(config);
        request.model_id = model_id.as_str().to_string();
        request.resume = resume;
        let response = self
            .client
            .clone()
            .start_training(request)
            .await
            .map_err(start_error_from_status)?
            .into_inner(); // StartTrainingResponse

        JobId::new(response.job_id).map_err(|e| StartTrainingError::StartOrderFailed(e.to_string()))
    }
}

impl TrainingResumer for GrpcTrainingStarter {
    async fn resume_training(
        &self,
        config: &TrainingConfig,
        model_id: &ModelId,
    ) -> Result<JobId, StartTrainingError> {
        let resume: bool = true;
        self.send(config, model_id, resume).await
    }
}

impl TrainingStarter for GrpcTrainingStarter {
    async fn start_training(
        &self,
        config: &TrainingConfig,
        model_id: &ModelId,
    ) -> Result<JobId, StartTrainingError> {
        let resume: bool = false;
        self.send(config, model_id, resume).await
    }
}

fn start_error_from_status(status: Status) -> StartTrainingError {
    match status.code() {
        Code::FailedPrecondition => {
            StartTrainingError::ResumePreconditionFailed(status.to_string())
        } // checkpointなし・エポック数が達している
        Code::Aborted => StartTrainingError::AlreadyRunning(status.to_string()), // 別のjobがすでに動いている
        Code::InvalidArgument => StartTrainingError::EngineRejectedConfig(status.to_string()),
        _ => StartTrainingError::StartOrderFailed(status.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn aborted_status_converts_to_already_running_error() {
        let error = start_error_from_status(Status::aborted("job is running"));
        assert!(matches!(error, StartTrainingError::AlreadyRunning(_)));
    }

    #[test]
    fn failed_precondition_status_converts_to_resume_precondition_failed_error() {
        let error = start_error_from_status(Status::failed_precondition("checkpoint not found"));
        assert!(matches!(
            error,
            StartTrainingError::ResumePreconditionFailed(_)
        ));
    }

    #[test]
    fn invalid_argument_status_converts_to_invalid_config_error() {
        let error = start_error_from_status(Status::invalid_argument("bad graph"));
        assert!(matches!(error, StartTrainingError::EngineRejectedConfig(_)));
    }

    #[test]
    fn other_status_converts_to_start_order_failed_error() {
        let error = start_error_from_status(Status::unavailable("server down"));
        assert!(matches!(error, StartTrainingError::StartOrderFailed(_)));
    }
}
