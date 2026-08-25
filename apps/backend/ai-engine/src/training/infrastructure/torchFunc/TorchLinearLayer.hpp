#pragma once

#include "training/adapters/interfaces/ILayer.hpp"
#include "training/entities/domain-objects/LinearParams.hpp"

#include <torch/nn/modules/linear.h>

class TorchLinearLayer : public ILayer
{
public:
    explicit TorchLinearLayer(const LinearParams &params);
    void forward(const at::Tensor &input, at::Tensor &output) override;

private:
    torch::nn::Linear _module;
};