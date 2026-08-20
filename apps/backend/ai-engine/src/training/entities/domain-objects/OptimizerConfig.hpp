#pragma once
#include "OptimizerType.hpp"

struct OptimizerConfig
{
    OptimizerType type = OptimizerType::Adam;
    double learningRate = 0.001;
    double weightDecay = 0.0;
};

struct AdamOptimizerConfig : public OptimizerConfig
{
    double beta1 = 0.9;
    double beta2 = 0.999;
    double eps = 1e-8;
};

struct SGDOptimizerConfig : public OptimizerConfig
{
    double momentum = 0.0;
    bool nesterov = false;
};

struct AdamWOptimizerConfig : public OptimizerConfig
{
    double beta1 = 0.9;
    double beta2 = 0.999;
};