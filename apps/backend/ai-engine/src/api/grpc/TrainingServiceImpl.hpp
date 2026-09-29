#pragma once

#include "training.grpc.pb.h"

#include "training/application/interfaces/ITrainingInfoProvider.hpp"

#include <memory>

// gRPC inbound adapter。training::v1::TrainingService::Service を実装する。
// 生成コード(training.pb.h / training.grpc.pb.h)に触れてよいのはこの層だけ。
class TrainingServiceImpl final : public training::v1::TrainingService::Service
{
public:
    TrainingServiceImpl(std::unique_ptr<ITrainingInfoProvider> trainingInfoProvider);
    // 単項
    grpc::Status StartTraining(grpc::ServerContext *context,
                               const training::v1::StartTrainingRequest *request,
                               training::v1::StartTrainingResponse *response) override;

    // サーバーストリーミング
    grpc::Status StreamProgress(grpc::ServerContext *context,
                                const training::v1::StreamProgressRequest *request,
                                grpc::ServerWriter<training::v1::StreamProgressResponse> *writer) override;

    // 単項
    grpc::Status StopTraining(grpc::ServerContext *context,
                              const training::v1::StopTrainingRequest *request,
                              training::v1::StopTrainingResponse *response) override;

private:
    std::unique_ptr<ITrainingInfoProvider> _trainingInfoProvider;
};