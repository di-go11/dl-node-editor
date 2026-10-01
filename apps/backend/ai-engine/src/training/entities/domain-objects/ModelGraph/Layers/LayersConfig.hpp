#pragma once

#include "training/entities/domain-objects/ModelGraph/Layers/LayersParams.hpp"
#include <variant>

using LayersParams = std::variant<Conv2DParams, PoolingParams, BatchNormParams, LinearParams, ActivationParams, IndexedPoolingParams, UnpoolingParams>;

struct LayersConfig
{
    /* data */
    LayersParams params;
};
