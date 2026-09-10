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
struct ModelGraph;

class TorchModel : public IModel
{
public:
    TorchModel(const ModelGraph &graph, ILayerBuilder &builder, const ComputeDevice &device);

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
    std::vector<std::shared_ptr<ILayer>> _layers;
};
