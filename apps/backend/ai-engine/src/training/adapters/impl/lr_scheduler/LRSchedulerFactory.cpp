#include "LRSchedulerFactory.hpp"

#include "training/entities/utils/Overloaded.hpp"

std::shared_ptr<ILearningRateScheduler> createLRScheduler(const LearningRateSchedulerConfig &config, LearningRateSchedulerType type, unsigned int totalEpochs)
{
    std::shared_ptr<ILearningRateScheduler> baseScheduler = std::visit(
        Overloaded{
            [&](const NoneLearningRateSchedulerConfig &) -> std::shared_ptr<ILearningRateScheduler>
            {
                return nullptr;
            },
            [&](const PolyLearningRateSchedulerConfig &polyConfig) -> std::shared_ptr<ILearningRateScheduler>
            {
                return std::make_shared<PolyLR>(totalEpochs, polyConfig.initialLR, polyConfig.power, type);
            },
            [&](const CosineLearningRateSchedulerConfig &cosineConfig) -> std::shared_ptr<ILearningRateScheduler>
            {
                return std::make_shared<CosineLR>(totalEpochs, cosineConfig.initialLR, cosineConfig.minLR, type);
            },
            [&](const StepLearningRateSchedulerConfig &stepConfig) -> std::shared_ptr<ILearningRateScheduler>
            {
                return std::make_shared<StepLR>(totalEpochs, stepConfig.initialLR, stepConfig.stepSize, stepConfig.gamma, type);
            }},
        config.scheduler);
    if (config.warmupEpochs > 0)
    {
        return std::make_shared<WarmupLR>(baseScheduler, config.warmupEpochs);
    }
    else
    {
        return baseScheduler;
    }
}