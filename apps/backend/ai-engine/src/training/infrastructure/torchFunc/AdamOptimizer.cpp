#include "training/infrastructure/torchFunc/AdamOptimizer.hpp"

#include <torch/torch.h>

AdamOptimizer::AdamOptimizer(std::vector<at::Tensor> &parameters, double learningRate, double beta1, double beta2, double eps, double weight_decay)
{
    _optim = std::make_unique<torch::optim::Adam>(parameters, torch::optim::AdamOptions(learningRate).betas(std::make_pair(beta1, beta2)).eps(eps).weight_decay(weight_decay));
}

void AdamOptimizer::resetGradients()
{
    _optim->zero_grad();
}

void AdamOptimizer::updateParmeters()
{
    _optim->step();
}