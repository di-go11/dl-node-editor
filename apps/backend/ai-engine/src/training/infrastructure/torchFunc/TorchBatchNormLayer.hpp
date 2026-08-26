#pragma once

#include "training/adapters/interfaces/ILayer.hpp"
#include "training/entities/domain-objects/BatchNormParams.hpp"

#include <torch/nn/modules/batchnorm.h>

class TorchBatchNormLayer : public ILayer
{
public:
    explicit TorchBatchNormLayer(const BatchNormParams &params);
    void forward(const at::Tensor &input, at::Tensor &output) override;
    std::vector<at::Tensor> parameters() const override;

private:
    torch::nn::BatchNorm2d _module;
};