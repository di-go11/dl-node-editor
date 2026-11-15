#include "api/grpc/GrpcApp.hpp"

#include "api/grpc/CapabilitiesServiceImpl.hpp"
#include "api/grpc/GrpcServer.hpp"
#include "api/grpc/TrainingServiceImpl.hpp"
#include "training/TrainingJob.hpp"
#include "training/adapters/impl/TrainingJobManager.hpp"
#include "training/infrastructure/readConfig/ConfigReader.hpp"
#include "training/infrastructure/torchFunc/CudaCapabilityProvider.hpp"
#include "training/infrastructure/torchFunc/SeedApplier.hpp"

#include <iostream>

namespace
{
    // サーバー側の設定(checkpoint の保存先・スレッド数など)。
    // 暫定で、.config があればそのサーバー設定を使い、なければ既定値を使う。
    // (ジョブの依頼の部分は gRPC のリクエストから来るので、.config のものは使わない)
    ServerConfig loadServerConfig()
    {
        ServerConfig config;
        const char *raw = std::getenv("AI_ENGINE_LOAD_IMAGE_THREADS");// 環境変数から得られるのはC言語の文字列(末尾が"\0"のchar*型)
        if (raw == nullptr)
        {
            std::cerr << "AI_ENGINE_LOAD_IMAGE_THREADS is not set. Using default threads(1) " << config.threadCount << std::endl;
            return config;
        }

        // 文字列を整数に変換する。
        const std::string_view value(raw); // (C++17)文字列を所有せず、参照するだけの軽量な型(変更できない。)
        size_t parsed = 0;
        const auto [end, ec] = std::from_chars(value.data(), value.data() + value.size(), parsed);

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
