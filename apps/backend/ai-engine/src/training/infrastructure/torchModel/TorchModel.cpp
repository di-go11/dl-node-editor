#include "training/infrastructure/torchModel/TorchModel.hpp"

#include "training/adapters/interfaces/ILayer.hpp"
#include "training/adapters/interfaces/ILayerBuilders.hpp"
#include "training/adapters/interfaces/ILoss.hpp"
#include "training/adapters/interfaces/IOptimizer.hpp"
#include "training/adapters/interfaces/IActivation.hpp"
#include "training/entities/domain-objects/ModelGraph.hpp"

#include <torch/torch.h>

TorchModel::TorchModel(const ModelGraph &graph, ILayerBuilder &builder)
{
    _layers.reserve(graph.layers.size());
    for (const auto &layerConfig : graph.layers)
    {
        _layers.push_back(builder.build(layerConfig));
    }
}

void TorchModel::train(at::Tensor &prediction, at::Tensor &target, ILoss &loss, IOptimizer &optimizer, IActivation &activationFn)
{
    at::Tensor current = prediction;
    at::Tensor next;
    for (auto &layer : _layers)
    {
        layer->forward(current, next);
        current = next;
    }

    at::Tensor activated;
    activationFn.activate(current, activated);

    at::Tensor lossValue;
    loss.lossOut(activated, target, lossValue);

    optimizer.resetGradients();
    lossValue.backward();
    optimizer.updateParmeters();

    prediction = activated;
}

std::vector<at::Tensor> TorchModel::parameters() const
{
    std::vector<at::Tensor> params;
    for (const auto &layer : _layers)
    {
        std::vector<at::Tensor> layerParams = layer->parameters();
        params.insert(params.end(), layerParams.begin(), layerParams.end());
    }
    return params;
}
