#pragma once

#include "training/entities/domain-objects/LayersParams.hpp"
#include <variant>

using LayersParams = std::variant<Conv2DParams, PoolingParams, BatchNormParams, LinearParams, ActivationParams>;

struct LayersConfig
{
    /* data */
    LayersParams params;
};
