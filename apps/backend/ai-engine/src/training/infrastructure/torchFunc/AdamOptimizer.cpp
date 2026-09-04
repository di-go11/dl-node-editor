#include "training/infrastructure/torchFunc/AdamOptimizer.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointArchive.hpp"

#include <torch/torch.h>

AdamOptimizer::AdamOptimizer(std::vector<at::Tensor> &parameters, double learningRate, double beta1, double beta2, double eps, double weight_decay)
{
    _optim = std::make_unique<torch::optim::Adam>(parameters, torch::optim::AdamOptions(learningRate).betas(std::make_pair(beta1, beta2)).eps(eps).weight_decay(weight_decay));
}

// ここは <torch/torch.h> を include 済みで torch::optim::Adam が完全型のため、
// unique_ptr の破棄コードをこの TU に閉じ込められる。
AdamOptimizer::~AdamOptimizer() = default;

void AdamOptimizer::resetGradients()
{
    _optim->zero_grad();
}

void AdamOptimizer::updateParmeters()
{
    _optim->step();
}

void AdamOptimizer::writeTo(ICheckpointWriter &archive) const
{
    _optim->save(toTorchArchive(archive));
}

void AdamOptimizer::readFrom(ICheckpointReader &archive)
{
    _optim->load(toTorchArchive(archive));
}
