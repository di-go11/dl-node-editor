#pragma once

#include "training/adapters/interfaces/IModel.hpp"

#include <memory>
#include <vector>

namespace at
{
    class Tensor;
}

class ILayer;
class ILayerBuilder;
struct ModelGraph;

class TorchModel : public IModel
{
public:
    TorchModel(const ModelGraph &graph, ILayerBuilder &builder);

    void train(torch::Tensor &prediction, torch::Tensor &target, ILoss &loss, IOptimizer &optimizer, IActivation &activationFn) override;

    std::vector<at::Tensor> parameters() const;

private:
    std::vector<std::shared_ptr<ILayer>> _layers;
};
