#pragma once

#include "training/adapters/interfaces/ILayer.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/LinearParams.hpp"

#include <torch/nn/modules/linear.h>

class TorchLinearLayer : public ILayer
{
public:
    explicit TorchLinearLayer(const LinearParams &params);
    std::vector<at::Tensor> forward(const std::vector<at::Tensor> &inputs) override;
    std::vector<at::Tensor> parameters() const override;
    void setTrain(bool trainingMode) override;
    void to(const ComputeDevice &device) override;

private:
    torch::nn::Linear _module;
};