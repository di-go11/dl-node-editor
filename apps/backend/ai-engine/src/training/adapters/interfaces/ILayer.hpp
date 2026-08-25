#pragma once

namespace at
{
    class Tensor;
}

class ILayer
{
public:
    virtual ~ILayer() = default;
    virtual void forward(const at::Tensor &input, at::Tensor &output) = 0;
    virtual void parameters() const = 0;
};