#pragma once

#include "training/adapters/interfaces/IModel.hpp"
#include "training/entities/domain-objects/ComputeDevice.hpp"

#include <memory>
#include <vector>

namespace at
{
    class Tensor;
}

class ILayer;
class ILayerBuilder;
class ValidatedModelGraph;

class TorchModel : public IModel
{
public:
    TorchModel(const ValidatedModelGraph &graph, ILayerBuilder &builder, const ComputeDevice &device);

    at::Tensor forward(const at::Tensor &input) override;

    at::Tensor trainStep(at::Tensor &input, at::Tensor &target, ILoss &loss, IOptimizer &optimizer) override;

    void writeTo(ICheckpointWriter &archive) const override;
    void readFrom(ICheckpointReader &archive) override;

    void setTrain() override;
    void setEval() override;

    /* void train(at::Tensor &prediction, at::Tensor &target, ILoss &loss, IOptimizer &optimizer) override;*/

    std::vector<at::Tensor> parameters() const override;

private:
    ComputeDevice _device;
    // ノード 1 つの入力 1 本分の接続元。fromGraphInput なら、グラフ入力(画像)を指す。
    struct InputSource
    {
        bool fromGraphInput = false;
        std::size_t node = 0; // 接続元のノードの添字(graph.nodes の添字)
        std::size_t port = 0; // 接続元の出力ポートの番号(nodePortsOf の出力ポートの順)
    };

    // _layers[i] / _inputs[i] は graph.nodes[i] に対応する(nodes の並び順で作る。parameters() の順番になる)。
    std::vector<std::shared_ptr<ILayer>> _layers;
    std::vector<std::vector<InputSource>> _inputs; // 層の forward に渡す順(nodePortsOf の入力ポートの順)
    std::vector<std::size_t> _order;               // 実行順(トポロジカル順)
    InputSource _output;                           // モデルの出力が指す、ノードと出力ポート
};
