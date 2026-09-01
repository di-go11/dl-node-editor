#include "training/infrastructure/torchModel/TorchModel.hpp"

#include "training/adapters/interfaces/ILayer.hpp"
#include "training/adapters/interfaces/ILayerBuilders.hpp"
#include "training/adapters/interfaces/ILoss.hpp"
#include "training/adapters/interfaces/IOptimizer.hpp"
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
/*
void TorchModel::train(at::Tensor &prediction, at::Tensor &target, ILoss &loss, IOptimizer &optimizer)
{
    // 層間の活性化(ReLU など)は graph.layers に活性化層として含まれ、この forward
    // ループで順に適用される。最終層は生ロジットを出力し、ここでは活性化を掛けない。
    at::Tensor current = prediction;
    at::Tensor next;
    for (auto &layer : _layers)
    {
        layer->forward(current, next);
        current = next;
    }

    at::Tensor lossValue;
    loss.lossOut(current, target, lossValue);

    std::cout << "LOSS値:" << lossValue << std::endl;

    optimizer.resetGradients();
    lossValue.backward();
    optimizer.updateParmeters();

    prediction = current;
}

*/
at::Tensor TorchModel::forward(const at::Tensor &input)
{
    at::Tensor current = input, next;
    for (auto &layer : _layers)
    {
        layer->forward(current, next);
        current = next;
    }
    return current;
}

at::Tensor TorchModel::trainStep(at::Tensor &input, at::Tensor &target, ILoss &loss, IOptimizer &optimizer)
{
    at::Tensor prediction = forward(input); // forwardの再利用

    at::Tensor lossValue;
    loss.lossOut(prediction, target, lossValue); // 損失計算

    optimizer.resetGradients();  // 勾配リセット
    lossValue.backward();        // 勾配計算
    optimizer.updateParmeters(); // パラメータ更新

    return lossValue.detach(); // 集計・ログ用(計算グラフからは切り離す)
}

void TorchModel::setTrain()
{
    for (auto &layer : _layers)
    {
        layer->setTrain(true);
    }
}

void TorchModel::setEval()
{
    for (auto &layer : _layers)
    {
        layer->setTrain(false);
    }
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
