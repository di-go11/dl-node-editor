#include "training/infrastructure/torchModel/TorchModel.hpp"

#include "training/adapters/interfaces/ILayer.hpp"
#include "training/adapters/interfaces/ILayerBuilders.hpp"
#include "training/adapters/interfaces/ILoss.hpp"
#include "training/adapters/interfaces/IOptimizer.hpp"
#include "training/entities/domain-objects/ModelGraph/DAG/GraphValidation.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/LayersPort.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointArchive.hpp"
#include "training/infrastructure/torchFunc/DeviceToTorch.hpp"

#include <torch/torch.h>

#include <stdexcept>
#include <string>
#include <unordered_map>

namespace
{
    // ポート名から、その番号(spec の中での位置)を引く。無ければ例外。
    // 検証済みのグラフでは必ず見つかるので、見つからないのは検証の抜けか、層の仕様の変更に追従していない場合。
    template <typename PortSpecs>
    std::size_t portIndexOf(const PortSpecs &ports, const std::string &name, const std::string &nodeId)
    {
        for (std::size_t i = 0; i < ports.size(); ++i)
        {
            if (ports[i].name == name)
            {
                return i;
            }
        }
        throw std::logic_error("TorchModel: ノード '" + nodeId + "' にポート '" + name + "' がありません");
    }
} // namespace

TorchModel::TorchModel(const ValidatedModelGraph &graph, ILayerBuilder &builder, const ComputeDevice &device)
    : _device(device), _order(graph.getOrder())
{
    const ModelGraph &g = graph.getGraph();

    std::unordered_map<std::string, std::size_t> indexOf;
    for (std::size_t i = 0; i < g.nodes.size(); ++i)
    {
        indexOf[g.nodes[i].id] = i;
    }

    // 接続元(ノード ID とポート名)を、forward で引きやすい添字に直す。
    auto resolve = [&](const PortRef &ref) -> InputSource
    {
        InputSource source;
        if (ref.nodeId.empty())
        {
            source.fromGraphInput = true; // グラフ入力
            return source;
        }
        source.node = indexOf.at(ref.nodeId);
        source.port = portIndexOf(layerPortsOf(g.nodes[source.node].spec).outputPorts, ref.port, ref.nodeId);
        return source;
    };

    // 層は nodes の並び順で作る(実行順ではない)。重みの初期値は、層を作る順に乱数を使って決まるため。
    _layers.reserve(g.nodes.size());
    _inputs.reserve(g.nodes.size());
    for (const GraphNode &node : g.nodes)
    {
        auto layer = builder.build(node.spec);
        layer->to(_device);
        _layers.push_back(std::move(layer));

        // 層の forward に渡す順(入力ポートの順)に、接続元を並べる。
        // 同じポートに複数つながる場合(Add / Concat)は、つないだ順に並ぶ。
        std::vector<InputSource> sources;
        for (const InputPortSpec &port : layerPortsOf(node.spec).inputPorts)
        {
            for (const NodeInput &input : node.inputs)
            {
                if (input.port == port.name)
                {
                    sources.push_back(resolve(input.source));
                }
            }
        }
        _inputs.push_back(std::move(sources));
    }

    // モデルの出力。outputs は当面 1 つだけ(検証で保証済み)。
    _output = resolve(g.outputs.at(0));
}

at::Tensor TorchModel::forward(const at::Tensor &input)
{
    const at::Tensor graphInput = input.to(training::infrastructure::torchFunc::deviceToTorch(_device));

    // results[i] = ノード i の出力(出力ポートの順)。後続のノードがここから引く。
    std::vector<std::vector<at::Tensor>> results(_layers.size());

    for (const std::size_t i : _order)
    {
        std::vector<at::Tensor> inputs;
        inputs.reserve(_inputs[i].size());
        for (const InputSource &source : _inputs[i])
        {
            inputs.push_back(source.fromGraphInput ? graphInput : results[source.node][source.port]);
        }
        results[i] = _layers[i]->forward(inputs);
    }

    return results[_output.node][_output.port];
}

at::Tensor TorchModel::trainStep(at::Tensor &input, at::Tensor &target, ILoss &loss, IOptimizer &optimizer)
{
    at::Tensor prediction = forward(input); // forwardの再利用(入力の device 合わせも forward 内で実施)

    at::Tensor targetOnDevice = target.to(training::infrastructure::torchFunc::deviceToTorch(_device));

    at::Tensor lossValue;
    loss.lossOut(prediction, targetOnDevice, lossValue); // 損失計算

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
        // checkpoint は別 device で保存されていることがある(CPU 保存 → GPU 再開 等)。
        // copy_ は cross-device を吸収するが、意図を明示するため現行 param の
        // device へ揃えてから書き戻す。
        current[i].copy_(loaded.to(current[i].device()));
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
