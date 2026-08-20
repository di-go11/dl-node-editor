#include "training/infrastructure/impl/header/SGDOptimizer.hpp"

#include <torch/torch.h>

SGDOptimizer::SGDOptimizer(std::vector<torch::Tensor> &parameters, double learningRate)
{
    _optim = std::make_unique<torch::optim::SGD>(parameters, torch::optim::SGDOptions(learningRate));
}

void SGDOptimizer::resetGradients()
{
    _optim->zero_grad();
}

void SGDOptimizer::updateParmeters()
{
    _optim->step();
}