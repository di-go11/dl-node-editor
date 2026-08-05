#pragma once

namespace torch
{
    class Tensor;
}

class TrainParams;

class ILoss
{
public:
    virtual ~ILoss() = default;
    virtual torch::Tensor computeLoss(const TrainParams &trainParams, const torch::Tensor &predicted, const torch::Tensor &target, torch::Tensor &output) = 0;
};