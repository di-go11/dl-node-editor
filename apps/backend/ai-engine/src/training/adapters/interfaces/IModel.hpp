#pragma once

#include <memory>

namespace at
{
    class Tensor;
}

class ILoss;
class IOptimizer;
class IActivation;

class IModel
{
public:
    virtual ~IModel() = default;

    virtual void train(at::Tensor &prediction, at::Tensor &target, ILoss &loss, IOptimizer &optimizer, IActivation &activationFn) = 0;
};