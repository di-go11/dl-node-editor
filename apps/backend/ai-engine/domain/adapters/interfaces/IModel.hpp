#pragma once

#include <memory>

namespace torch
{
    class Tensor;
}

class IForward;
class IBackward;
class ILoss;
class IOptimizer;
class IZeroGrad;

class IModel
{
public:
    virtual ~IModel() = default;

    virtual void train(torch::Tensor &prediction, torch::Tensor &target, ILoss &loss, IOptimizer &optimizer, IZeroGrad &zeroGrad) = 0;
};