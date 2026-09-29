#pragma once

#include "training/entities/domain-objects/MetricsConfig.hpp"

#include <string>

struct TrainingProcessSnapshot
{
    unsigned int epoch;
    double train_loss;
    double val_loss;
    std::string status;
    MetricsConfig metrics;
};

class ITrainingInfoProvider
{
public:
    virtual ~ITrainingInfoProvider() = default;
    virtual TrainingProcessSnapshot getTrainingProcessSnapshot() = 0;
};
