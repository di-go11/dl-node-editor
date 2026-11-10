#pragma once

#include "ActivationType.hpp"

struct ActivationSpec
{
    ActivationType activationType = ActivationType::ReLU;
    int dim = 1; // Softmaxでのみ使用
};