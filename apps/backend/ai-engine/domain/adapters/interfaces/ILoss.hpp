#pragma once

namespace torch
{
    class Tensor;
}

class ILoss
{
public:
    virtual ~ILoss() = default;
    virtual torch::Tensor computeLoss(const torch::Tensor &predicted, const torch::Tensor &target, torch::Tensor &output) = 0;
};