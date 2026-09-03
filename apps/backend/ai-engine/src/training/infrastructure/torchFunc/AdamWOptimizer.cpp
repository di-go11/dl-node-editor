#include "training/infrastructure/torchFunc/AdamWOptimizer.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointArchive.hpp"

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

void AdamWOptimizer::writeTo(ICheckpointWriter &archive) const
{
    _optim->save(toTorchArchive(archive));
}

void AdamWOptimizer::readFrom(ICheckpointReader &archive)
{
    _optim->load(toTorchArchive(archive));
}