#pragma once
#include "training/adapters/interfaces/IOptimizer.hpp"

#include <memory>
#include <vector>

namespace torch
{
    class Tensor;
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
    SGDOptimizer(std::vector<torch::Tensor> &parameters, double learningRate);
    void resetGradients() override;
    void updateParmeters() override;
};