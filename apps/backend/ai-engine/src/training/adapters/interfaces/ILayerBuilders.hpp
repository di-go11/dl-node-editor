#pragma once

#include "training/entities/domain-objects/ModelGraph/Layers/LayersConfig.hpp"
#include <memory>

class ILayer;

class ILayerBuilder
{
public:
    virtual ~ILayerBuilder() = default;
    virtual std::shared_ptr<ILayer> build(const LayersConfig &config) = 0;
};