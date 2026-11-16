#include "api/grpc/GrpcApp.hpp"

#include "api/grpc/CapabilitiesServiceImpl.hpp"
#include "api/grpc/GrpcServer.hpp"
#include "api/grpc/TrainingServiceImpl.hpp"
#include "training/TrainingJob.hpp"
#include "training/adapters/impl/TrainingJobManager.hpp"
#include "training/infrastructure/torchFunc/CudaCapabilityProvider.hpp"
#include "training/infrastructure/torchFunc/SeedApplier.hpp"
#include "training/infrastructure/serve/TrainingRuntimeConfig.hpp"

#include <iostream>

namespace
{
    // 学習の実行環境の設定(checkpoint の保存先・画像読み込みのスレッド数など)。環境変数から読む。
    TrainingRuntimeConfig loadServerEnv()
    {
        TrainingRuntimeConfig config;
        // 環境変数から得られるのはC言語の文字列(末尾が"\0"のchar*型)
        if (const char *raw = std::getenv("AI_ENGINE_LOAD_IMAGE_THREADS"))
        {
            if (!config.setImageLoadThreadCount(raw))
            {
                std::cerr << "AI_ENGINE_LOAD_IMAGE_THREADS is invalid: \"" << raw
                          << "\". Using default (" << config.imageLoadThreadCount << ")" << std::endl;
            }
        }

        return config;
    }
}

void runGrpcServer()
{
    CudaCapabilityProvider provider;
    CapabilitiesServiceImpl capabilitiesService(provider);

    const TrainingRuntimeConfig trainingRuntimeConfig = loadServerEnv();
    TrainingJobManager jobManager(
        [trainingRuntimeConfig](const StartTrainingCommand &command,
                                const std::shared_ptr<ITrainingProgressObserver> &progressObserver,
                                const TrainingStopToken *stopToken)
        {
            SeedApplier seedApplier;
            return runTrainingJob(trainingRuntimeConfig, command, progressObserver, seedApplier, stopToken);
        },
        // 再開できない依頼は、学習スレッドを起動する前に弾いて StartTraining の応答で返す。
        [trainingRuntimeConfig](const StartTrainingCommand &command)
        {
            checkTrainingJobPreconditions(trainingRuntimeConfig, command);
        });
    TrainingServiceImpl trainingService(jobManager);

    GrpcServer server("0.0.0.0:50051", {&capabilitiesService, &trainingService});
    server.run();
}
