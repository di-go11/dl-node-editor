#pragma once

namespace torch
{
    class Tensor;
}

class TrainParams;

class IActivation
{
public:
    virtual ~IActivation() = default;
    virtual void activate(const TrainParams &trainParams, torch::Tensor &input, torch::Tensor &output) = 0;
};