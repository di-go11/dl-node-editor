#include "LRSchedulerFactory.hpp"

#include "StepLR.hpp"
#include "PolyLR.hpp"
#include "CosineLR.hpp"
#include "WarmupLR.hpp"

#include "training/entities/utils/Overloaded.hpp"

#include <stdexcept>
#include <variant>

std::shared_ptr<ILearningRateScheduler> createLRScheduler(const LearningRateSchedulerConfig &config,
                                                          double baseLR,
                                                          unsigned int totalEpochs,
                                                          uint64_t batchesPerEpoch)
{
    const bool isNone = std::holds_alternative<NoneLearningRateSchedulerConfig>(config.scheduler);
    if (isNone)
    {
        // スケジューラーなしで warmup だけ指定されても、上げる目標の学習率が決まらない。
        if (config.warmupEpochs > 0)
        {
            throw std::invalid_argument("lr_scheduler: warmupEpochs を使うにはスケジューラーの種類を指定してください");
        }
        return nullptr;
    }

    if (config.warmupEpochs >= totalEpochs)
    {
        throw std::invalid_argument("lr_scheduler: warmupEpochs は総エポック数より小さくしてください");
    }

    // 1 エポックが何ステップか。ここから先はすべてステップ単位で扱う。
    const uint64_t stepsPerEpoch =
        config.updateInterval == LearningRateUpdateInterval::PerBatch ? batchesPerEpoch : 1;
    if (stepsPerEpoch == 0)
    {
        throw std::invalid_argument("lr_scheduler: 学習データのバッチ数が 0 です");
    }

    const uint64_t totalSteps = static_cast<uint64_t>(totalEpochs) * stepsPerEpoch;
    const uint64_t warmupSteps = static_cast<uint64_t>(config.warmupEpochs) * stepsPerEpoch;
    // warmup の分だけ本来のスケジュールを後ろにずらすので、本来のスケジュールの長さは T - W。
    const uint64_t baseTotalSteps = totalSteps - warmupSteps;
    const LearningRateUpdateInterval interval = config.updateInterval;

    std::shared_ptr<ILearningRateScheduler> baseScheduler = std::visit(
        Overloaded{
            [&](const NoneLearningRateSchedulerConfig &) -> std::shared_ptr<ILearningRateScheduler>
            {
                return nullptr; // 上で処理済みのため到達しない
            },
            [&](const PolyLearningRateSchedulerConfig &polyConfig) -> std::shared_ptr<ILearningRateScheduler>
            {
                return std::make_shared<PolyLR>(baseTotalSteps, baseLR, polyConfig.power, interval);
            },
            [&](const CosineLearningRateSchedulerConfig &cosineConfig) -> std::shared_ptr<ILearningRateScheduler>
            {
                return std::make_shared<CosineLR>(baseTotalSteps, baseLR, cosineConfig.minLR, interval);
            },
            [&](const StepLearningRateSchedulerConfig &stepConfig) -> std::shared_ptr<ILearningRateScheduler>
            {
                if (stepConfig.stepSize == 0)
                {
                    throw std::invalid_argument("lr_scheduler: stepSize は 1 以上にしてください");
                }
                const uint64_t stepSizeInSteps = static_cast<uint64_t>(stepConfig.stepSize) * stepsPerEpoch;
                return std::make_shared<StepLR>(stepSizeInSteps, baseLR, stepConfig.gamma, interval);
            }},
        config.scheduler);

    if (warmupSteps > 0)
    {
        return std::make_shared<WarmupLR>(baseScheduler, warmupSteps);
    }
    return baseScheduler;
}
