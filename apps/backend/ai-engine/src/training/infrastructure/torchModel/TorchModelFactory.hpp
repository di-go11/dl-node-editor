#pragma once

#include "training/adapters/interfaces/IModelFactory.hpp"
#include "training/infrastructure/torchFunc/TorchLayerBuilder.hpp"

#include <memory>

// IModelFactory の libtorch 実装。TorchLayerBuilder を内包し、
// ModelGraph から TorchModel を組み立てる。
class TorchModelFactory : public IModelFactory
{
public:
    std::shared_ptr<IModel> create(const ModelGraph &graph) override;

private:
    TorchLayerBuilder _builder;
};
