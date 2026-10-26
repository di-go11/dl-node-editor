use entities::training::TrainingJobStatus;
use entities::training::{JobId, TrainingJobStatus};
use usecases::training::StopTrainingError;
use usecases::training::TrainingStopper;

pub struct GrpcTrainingStopper {
    client: TrainingServiceClient<Channel>, // gRPC通信をするためのフィールド. Channel型を指定することで、
}

impl TrainingStopper for GrpcTrainingStopper {
    fn stop_training(
        &self,
        job_id: &JobId,
    ) -> impl std::prelude::rust_2024::Future<Output = Result<TrainingJobStatus, StopTrainingError>> + Send
    {
        let request = 
    }
}
