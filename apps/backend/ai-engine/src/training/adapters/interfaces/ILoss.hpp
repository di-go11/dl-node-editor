#pragma once

namespace at
{
    class Tensor;
}

class ILoss
{
public:
    virtual ~ILoss() = default;
    virtual void lossOut(const at::Tensor &predicted, const at::Tensor &target, at::Tensor &output) = 0;
};