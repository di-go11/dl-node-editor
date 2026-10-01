#pragma once

#include "training/entities/domain-objects/ModelGraph/Layers/LayersConfig.hpp"
#include <vector>

struct ModelGraph
{
    std::vector<LayersConfig> layers;
};
