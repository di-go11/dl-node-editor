#pragma once

#include "training/entities/domain-objects/ModelGraph/Layers/UnpoolingParams.hpp"
#include "training/adapters/interfaces/ILayer.hpp"
#include "training/adapters/interfaces/IIndicesSink.hpp"

#include <torch/nn/modules/pooling.h>

class TorchUnpoolingLayer : public IIndicesSink, public ILayer
{
public:
    explicit TorchUnpoolingLayer(const UnpoolingParams &params);

    void forward(const at::Tensor &input, at::Tensor &output) override;
    std::vector<at::Tensor> parameters() const override;
    void setTrain(bool trainingMode) override;
    void to(const ComputeDevice &device) override;

    void provideIndices(const at::Tensor &indices) override;

private:
    torch::nn::MaxUnpool2d _module;
    at::Tensor _indices;
};