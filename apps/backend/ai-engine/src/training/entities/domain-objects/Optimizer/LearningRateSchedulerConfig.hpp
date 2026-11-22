#pragma once

#include <variant>

struct NoneLearningRateSchedulerConfig
{
};

struct PolyLearningRateSchedulerConfig
{
    double initialLR = 0.0;
    double power = 0.9;
};

struct CosineLearningRateSchedulerConfig
{
    double initialLR = 0.0;
    double minLR = 0.0;
};

struct StepLearningRateSchedulerConfig
{
    double initialLR = 0.0;
    unsigned stepSize = 30;
    double gamma = 0.1;
};

using LearningRateSchedulerKind = std::variant<NoneLearningRateSchedulerConfig, PolyLearningRateSchedulerConfig, CosineLearningRateSchedulerConfig, StepLearningRateSchedulerConfig>;

struct LearningRateSchedulerConfig
{
    LearningRateSchedulerKind scheduler = NoneLearningRateSchedulerConfig{};
    unsigned int warmupEpochs = 0;
};