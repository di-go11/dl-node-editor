#pragma once

#include <vector>

namespace at
{
    class Tensor;
}

class ILayer
{
public:
    virtual ~ILayer() = default;
    virtual void forward(const at::Tensor &input, at::Tensor &output) = 0;
    virtual std::vector<at::Tensor> parameters() const = 0;

    virtual void setTrain(bool trainingMode) = 0;
};