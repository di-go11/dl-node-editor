use entities::training::{JobId, TrainingJobStatus};
use entities::training::
use usecases::training::TrainingStopper;

pub struct GrpcTrainingStopper {
    client: TrainingServiceClient<Channel>, // gRPC通信をするためのフィールド. Channel型を指定することで、
}

impl TrainingStopper for GrpcTrainingStopper {
    fn stop_training(
        &self,
        job_id: &entities::training::JobId,
    ) -> impl std::prelude::rust_2024::Future<
        Output = Result<
            entities::training::TrainingJobStatus,
            usecases::training::StartTrainingError,
        >,
    > + Send {
    }
}
