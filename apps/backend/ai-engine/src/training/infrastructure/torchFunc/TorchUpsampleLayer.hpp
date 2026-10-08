#pragma once

#include "training/entities/domain-objects/ModelGraph/Layers/UpsampleSpec.hpp"
#include "training/adapters/interfaces/ILayer.hpp"

#include <torch/nn/modules/upsampling.h>
#include <vector>

class TorchUpsampleLayer : public ILayer
{
public:
    explicit TorchUpsampleLayer(const UpsampleSpec &specs);

    std::vector<at::Tensor> forward(const std::vector<at::Tensor> &inputs) override;
    std::vector<at::Tensor> parameters() const override;
    void setTrain(bool trainingMode) override;
    void to(const ComputeDevice &device) override;

private:
    torch::nn::Upsample _module;
};