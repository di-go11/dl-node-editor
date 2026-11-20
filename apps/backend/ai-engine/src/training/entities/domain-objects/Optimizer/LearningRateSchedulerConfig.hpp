#pragma once

#include "LearningRateSchedulerType.hpp"
#include "training/entities/utils/Overloaded.hpp"

#include <variant>

struct NoneLearningRateSchedulerConfig
{
};

struct PolyLearningRateSchedulerConfig
{
    double power = 0.9;
};

struct CosineLearningRateSchedulerConfig
{
    double minLearningRate = 0.0;
};

struct StepLearningRateSchedulerConfig
{
    unsigned stepSize = 30;
    double gamma = 0.1;
};

using LearningRateSchedulerKind = std::variant<NoneLearningRateSchedulerConfig, PolyLearningRateSchedulerConfig, CosineLearningRateSchedulerConfig, StepLearningRateSchedulerConfig>;

struct LearningRateSchedulerConfig
{
    LearningRateSchedulerKind scheduler = NoneLearningRateSchedulerConfig{};
    unsigned int warmupEpochs = 0;
};