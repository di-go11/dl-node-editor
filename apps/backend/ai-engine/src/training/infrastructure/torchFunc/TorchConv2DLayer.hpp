#pragma once

#include "training/adapters/interfaces/ILayer.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/Conv2DParams.hpp"

#include <torch/nn/modules/conv.h>

class TorchConv2DLayer : public ILayer
{
public:
    explicit TorchConv2DLayer(const Conv2DParams &params);
    std::vector<at::Tensor> forward(const std::vector<at::Tensor> &inputs) override;
    std::vector<at::Tensor> parameters() const override;
    void setTrain(bool trainingMode) override;
    void to(const ComputeDevice &device) override;

private:
    torch::nn::Conv2d _module;
};