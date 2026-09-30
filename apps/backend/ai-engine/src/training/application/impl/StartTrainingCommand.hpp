#pragma once

#include <string>
#include "training/entities/domain-objects/ModelGraph.hpp"
#include "training/entities/domain-objects/OptimizerConfig.hpp"
#include "training/entities/domain-objects/LossConfig.hpp"
#include "training/entities/domain-objects/ComputeDevice.hpp"

struct StartTrainingCommand
{
    std::string modelName;
    OptimizerConfig optimizer;
    LossConfig loss;
    unsigned int epochSize;
    unsigned int batchSize;
    std::string datasetPath;
    ComputeDevice device;
};