use entities::training::TrainingProcess;
use tonic::transport::Channel;
use usecases::training;

use crate::training::{TrainingProcessProviderError, TrainingProcessProvider};

use crate::pb::training::v1::training_service_client::{self, TrainingServiceClient};

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
    async fn fetch(&self) -> Result<TrainingProcess, TrainingProcessProviderError> {
        let response = self.client.clone().get_
    }
}