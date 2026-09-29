#include "TrainingServiceImpl.hpp"

grpc::Status TrainingServiceImpl::StartTraining(grpc::ServerContext *context,
                                                const training::v1::StartTrainingRequest *request,
                                                training::v1::StartTrainingResponse *response)
{
    return grpc::Status(grpc::StatusCode::UNIMPLEMENTED, "StartTraining is not implemented yet");
}

grpc::Status TrainingServiceImpl::StreamProgress(grpc::ServerContext *context,
                                                 const training::v1::StreamProgressRequest *request,
                                                 grpc::ServerWriter<training::v1::StreamProgressResponse> *writer)
{
    return grpc::Status(grpc::StatusCode::UNIMPLEMENTED, "StreamProgress is not implemented yet");
}

grpc::Status TrainingServiceImpl::StopTraining(grpc::ServerContext *context,
                                               const training::v1::StopTrainingRequest *request,
                                               training::v1::StopTrainingResponse *response)
{
    return grpc::Status(grpc::StatusCode::UNIMPLEMENTED, "StopTraining is not implemented yet");
}
