#pragma once

namespace at
{
    class Tensor;
}

class IActivation
{
public:
    virtual ~IActivation() = default;
    virtual void activate(const at::Tensor &input, at::Tensor &output) = 0;
};