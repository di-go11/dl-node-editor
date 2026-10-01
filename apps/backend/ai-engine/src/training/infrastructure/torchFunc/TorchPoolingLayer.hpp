#pragma once

#include "training/adapters/interfaces/ILayer.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/PoolingParams.hpp"

#include <torch/nn/modules/pooling.h>
#include <variant>

class TorchPoolingLayer : public ILayer
{
public:
    explicit TorchPoolingLayer(const PoolingParams &params);
    std::vector<at::Tensor> forward(const std::vector<at::Tensor> &inputs) override;
    std::vector<at::Tensor> parameters() const override;
    void setTrain(bool trainingMode) override;
    void to(const ComputeDevice &device) override;

private:
    std::variant<torch::nn::MaxPool2d, torch::nn::AvgPool2d> _module;
};