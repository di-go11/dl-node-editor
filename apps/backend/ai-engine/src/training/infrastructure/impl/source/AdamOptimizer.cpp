#include "training/infrastructure/impl/header/AdamOptimizer.hpp"

#include <torch/torch.h>

AdamOptimizer::AdamOptimizer(std::vector<torch::Tensor> &parameters, double learningRate)
{
    _optim = std::make_unique<torch::optim::Adam>(parameters, torch::optim::AdamOptions(learningRate));
}

void AdamOptimizer::resetGradients()
{
    _optim->zero_grad();
}

void AdamOptimizer::updateParmeters()
{
    _optim->step();
}