#pragma once

#include "training/entities/domain-objects/ModelGraph/Layers/UnpoolingSpec.hpp"
#include "training/adapters/interfaces/ILayer.hpp"

#include <torch/nn/modules/pooling.h>

class TorchUnpoolingLayer : public ILayer
{
public:
    explicit TorchUnpoolingLayer(const UnpoolingSpec &params);

    std::vector<at::Tensor> forward(const std::vector<at::Tensor> &inputs) override;
    std::vector<at::Tensor> parameters() const override;
    void setTrain(bool trainingMode) override;
    void to(const ComputeDevice &device) override;

private:
    torch::nn::MaxUnpool2d _module;
};