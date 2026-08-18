#pragma once

namespace torch
{
    class Tensor;
}

class IActivation
{
public:
    virtual ~IActivation() = default;
    virtual void activate(const torch::Tensor &input, torch::Tensor &output) = 0;
};