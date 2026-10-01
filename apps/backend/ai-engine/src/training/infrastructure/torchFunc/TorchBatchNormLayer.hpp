#pragma once

#include "training/adapters/interfaces/ILayer.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/BatchNormParams.hpp"

#include <torch/nn/modules/batchnorm.h>

class TorchBatchNormLayer : public ILayer
{
public:
    explicit TorchBatchNormLayer(const BatchNormParams &params);
    std::vector<at::Tensor> forward(const std::vector<at::Tensor> &inputs) override;
    std::vector<at::Tensor> parameters() const override;
    void setTrain(bool trainingMode) override;
    void to(const ComputeDevice &device) override;

private:
    torch::nn::BatchNorm2d _module;
};