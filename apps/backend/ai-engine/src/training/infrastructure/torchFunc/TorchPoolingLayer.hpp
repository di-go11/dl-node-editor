#pragma once

#include "training/adapters/interfaces/ILayer.hpp"
#include "training/entities/domain-objects/PoolingParams.hpp"

#include <torch/nn/modules/pooling.h>
#include <variant>

class TorchPoolingLayer : public ILayer
{
public:
    explicit TorchPoolingLayer(const PoolingParams &params);
    void forward(const at::Tensor &input, at::Tensor &output) override;

private:
    std::variant<torch::nn::MaxPool2d, torch::nn::AvgPool2d> _param;
};