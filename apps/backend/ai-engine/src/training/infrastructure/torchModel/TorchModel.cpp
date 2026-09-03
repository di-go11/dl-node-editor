#include "training/infrastructure/torchModel/TorchModel.hpp"

#include "training/adapters/interfaces/ILayer.hpp"
#include "training/adapters/interfaces/ILayerBuilders.hpp"
#include "training/adapters/interfaces/ILoss.hpp"
#include "training/adapters/interfaces/IOptimizer.hpp"
#include "training/entities/domain-objects/ModelGraph.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointArchive.hpp"

#include <torch/torch.h>

#include <stdexcept>
#include <string>

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

void TorchModel::writeTo(ICheckpointWriter &archive) const
{
    torch::serialize::OutputArchive &out = toTorchArchive(archive);

    const std::vector<at::Tensor> params = parameters();
    out.write("model_param_count", torch::tensor(static_cast<int64_t>(params.size())));
    for (std::size_t i = 0; i < params.size(); ++i)
    {
        out.write("model_param_" + std::to_string(i), params[i]);
    }
}

void TorchModel::readFrom(ICheckpointReader &archive)
{
    torch::serialize::InputArchive &in = toTorchArchive(archive);

    std::vector<at::Tensor> current = parameters();

    at::Tensor countTensor;
    in.read("model_param_count", countTensor);
    const auto storedCount = static_cast<std::size_t>(countTensor.item<int64_t>());
    if (storedCount != current.size())
    {
        throw std::runtime_error(
            "TorchModel::readFrom: parameter count mismatch (archive=" +
            std::to_string(storedCount) + ", model=" + std::to_string(current.size()) + ")");
    }

    // parameters() が返すテンソルはモデル内部と記憶域を共有しているため、
    // copy_ で値を書き戻すとモデルの重みが更新される。
    torch::NoGradGuard noGrad;
    for (std::size_t i = 0; i < current.size(); ++i)
    {
        at::Tensor loaded;
        in.read("model_param_" + std::to_string(i), loaded);
        current[i].copy_(loaded);
    }
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
