#pragma once

#include "training.grpc.pb.h"

#include "training/application/interfaces/ITrainingJobManager.hpp"

// gRPC inbound adapter。training::v1::TrainingService::Service を実装する。
// 生成コード(training.pb.h / training.grpc.pb.h)に触れてよいのはこの層だけ。
// ITrainingJobManager 経由でジョブを操作し、proto との変換は TrainingProtoMapper に任せる。
class TrainingServiceImpl final : public training::v1::TrainingService::Service
{
public:
    explicit TrainingServiceImpl(ITrainingJobManager &jobManager);

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
    ITrainingJobManager &_jobManager; // 所有しない。呼び出し側(GrpcApp)が生存を保証
};
