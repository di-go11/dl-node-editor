#pragma once

namespace torch
{
    class Tensor;
}

class TrainParam;

class ILoss
{
public:
    virtual ~ILoss() = default;
    virtual torch::Tensor computeLoss(const TrainParam &trainParam, torch::Tensor &predicted, torch::Tensor &target) = 0;
};