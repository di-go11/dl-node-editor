use entities::training::{config::TrainingConfig, JobId};
use tonic::transport::Channel;
use usecases::training::StartTrainingError;
use usecases::training::TrainingStarter;

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
            .map_err(|status| StartTrainingError::StartOrderFailed(status.to_string()))?
            .into_inner(); // StartTrainingResponse

        // proto の String をドメインの JobId に変換(空文字列ならエラー)
        JobId::new(response.job_id).map_err(|e| StartTrainingError::StartOrderFailed(e.to_string()))
    }
}
