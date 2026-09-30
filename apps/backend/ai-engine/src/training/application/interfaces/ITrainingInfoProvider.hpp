#pragma once

#include "training/entities/domain-objects/Metrics/TaskMetrics.hpp"

#include <string>

struct TrainingProcessSnapshot
{
    unsigned int epoch;
    double train_loss;
    double val_loss;
    std::string status;
    TaskMetrics metrics;
};

class ITrainingInfoProvider
{
public:
    virtual ~ITrainingInfoProvider() = default;
    virtual TrainingProcessSnapshot getTrainingProcessSnapshot() = 0;
};
