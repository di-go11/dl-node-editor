#include "api/grpc/GrpcApp.hpp"

#include "api/grpc/CapabilitiesServiceImpl.hpp"
#include "api/grpc/GrpcServer.hpp"
#include "api/grpc/TrainingServiceImpl.hpp"
#include "training/TrainingJob.hpp"
#include "training/adapters/impl/TrainingJobManager.hpp"
#include "training/infrastructure/readConfig/ConfigReader.hpp"
#include "training/infrastructure/torchFunc/CudaCapabilityProvider.hpp"
#include "training/infrastructure/torchFunc/SeedApplier.hpp"

#include <filesystem>
#include <iostream>

namespace
{
    // サーバー側の設定(checkpoint の保存先・スレッド数など)。
    // 暫定で、.config があればそのサーバー設定を使い、なければ既定値を使う。
    // (ジョブの依頼の部分は gRPC のリクエストから来るので、.config のものは使わない)
    ServerConfig loadServerConfig()
    {
        const std::string path = ".config";
        if (!std::filesystem::exists(path))
        {
            std::cout << "server config: " << path << " が見つからないため既定値を使います" << std::endl;
            return ServerConfig{};
        }
        return ConfigReader{}.readAll(path).server;
    }
}

void runGrpcServer()
{
    CudaCapabilityProvider provider;
    CapabilitiesServiceImpl capabilitiesService(provider);

    const ServerConfig serverConfig = loadServerConfig();
    TrainingJobManager jobManager(
        [serverConfig](const StartTrainingCommand &command,
                       const std::shared_ptr<ITrainingProgressObserver> &progressObserver,
                       const TrainingStopToken *stopToken)
        {
            SeedApplier seedApplier;
            return runTrainingJob(serverConfig, command, progressObserver, seedApplier, stopToken);
        },
        // 再開できない依頼は、学習スレッドを起動する前に弾いて StartTraining の応答で返す。
        [serverConfig](const StartTrainingCommand &command)
        {
            checkTrainingJobPreconditions(serverConfig, command);
        });
    TrainingServiceImpl trainingService(jobManager);

    GrpcServer server("0.0.0.0:50051", {&capabilitiesService, &trainingService});
    server.run();
}
