#pragma once

namespace at
{
    class Tensor;
}

class IIndicesSink
{
public:
    virtual ~IIndicesSink() = default;
    virtual void provideIndices(const at::Tensor &indices) = 0;
};