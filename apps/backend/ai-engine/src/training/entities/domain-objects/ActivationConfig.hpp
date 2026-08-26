#pragma once

#include "ActivationType.hpp"

struct ActivationConfig
{
    ActivationType activationType = ActivationType::ReLU;
    int dim = 1; // Softmaxでのみ使用
};