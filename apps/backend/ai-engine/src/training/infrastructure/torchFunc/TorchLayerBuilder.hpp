#pragma once

#include "training/adapters/interfaces/ILayerBuilders.hpp"
#include <memory>

class TorchLayerBuilder : public ILayerBuilder
{
public:
    TorchLayerBuilder();
    std::shared_ptr<ILayer> build(const LayersConfig &config);
};