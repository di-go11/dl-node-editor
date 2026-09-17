#pragma once

namespace at
{
    class Tensor;
}

class IIndicesSource
{
public:
    virtual ~IIndicesSource() = default;
    virtual at::Tensor takeIndices() = 0;
};