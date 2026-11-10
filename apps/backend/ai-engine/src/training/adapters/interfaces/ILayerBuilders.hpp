#pragma once

#include "training/entities/domain-objects/ModelGraph/NodeSpec.hpp"
#include <memory>

class ILayer;

class ILayerBuilder
{
public:
    virtual ~ILayerBuilder() = default;
    virtual std::shared_ptr<ILayer> build(const NodeSpec &config) = 0;
};