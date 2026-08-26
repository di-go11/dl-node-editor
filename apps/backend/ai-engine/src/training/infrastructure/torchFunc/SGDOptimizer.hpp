#pragma once
#include "training/adapters/interfaces/IOptimizer.hpp"

#include <memory>
#include <vector>

namespace at
{
    class Tensor;
}

namespace torch
{
    namespace optim
    {
        class SGD;
    }
}

class SGDOptimizer : public IOptimizer
{

private:
    std::unique_ptr<torch::optim::SGD> _optim;

public:
    SGDOptimizer(std::vector<at::Tensor> &parameters, double learningRate, double momentum = 0.9, double weight_decay = 1e-4, bool nesterov = false);
    void resetGradients() override;
    void updateParmeters() override;
};