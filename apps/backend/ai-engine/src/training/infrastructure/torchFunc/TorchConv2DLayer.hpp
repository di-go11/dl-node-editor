#pragma once

#include "training/adapters/interfaces/ILayer.hpp"
#include "training/entities/domain-objects/Conv2DParams.hpp"

#include <torch/nn/modules/conv.h>

class TorchConv2DLayer : public ILayer
{
public:
    explicit TorchConv2DLayer(const Conv2DParams &params);
    void forward(const at::Tensor &input, at::Tensor &output) override;
    std::vector<at::Tensor> parameters() const override;
    void setTrain(bool trainingMode) override;

private:
    torch::nn::Conv2d _module;
};