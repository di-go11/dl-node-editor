#pragma once

#include "training/adapters/interfaces/ILayer.hpp"

#include <torch/torch.h>
#include <vector>

struct ConcatSpec;

class TorchConcatLayer : public ILayer
{
public:
    explicit TorchConcatLayer(const ConcatSpec &params);
    std::vector<at::Tensor> forward(const std::vector<at::Tensor> &inputs) override;
    std::vector<at::Tensor> parameters() const override;

    void setTrain(bool trainingMode) override;

    void to(const ComputeDevice &device) override;
};
