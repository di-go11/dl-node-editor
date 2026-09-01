#include "training/infrastructure/torchFunc/AdamWOptimizer.hpp"

#include <torch/torch.h>

AdamWOptimizer::AdamWOptimizer(std::vector<at::Tensor> &parameters, double learningRate, double beta1, double beta2, double weight_decay)
{
    _optim = std::make_unique<torch::optim::AdamW>(parameters, torch::optim::AdamWOptions(learningRate).betas(std::make_pair(beta1, beta2)).weight_decay(weight_decay));
}

void AdamWOptimizer::resetGradients()
{
    _optim->zero_grad();
}

void AdamWOptimizer::updateParmeters()
{
    _optim->step();
}

void AdamWOptimizer::saveState(const std::string &filePath)
{
    torch::save(*_optim, filePath);
}

void AdamWOptimizer::loadState(const std::string &filePath)
{
    torch::load(*_optim, filePath);
}