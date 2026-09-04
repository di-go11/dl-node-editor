#include "training/infrastructure/torchFunc/SGDOptimizer.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointArchive.hpp"

#include <torch/torch.h>

SGDOptimizer::SGDOptimizer(std::vector<at::Tensor> &parameters, double learningRate, double momentum, double weight_decay, bool nesterov)
{
    _optim = std::make_unique<torch::optim::SGD>(parameters, torch::optim::SGDOptions(learningRate).momentum(momentum).weight_decay(weight_decay).nesterov(nesterov));
}

// ここは <torch/torch.h> を include 済みで torch::optim::SGD が完全型のため、
// unique_ptr の破棄コードをこの TU に閉じ込められる。
SGDOptimizer::~SGDOptimizer() = default;

void SGDOptimizer::resetGradients()
{
    _optim->zero_grad();
}

void SGDOptimizer::updateParmeters()
{
    _optim->step();
}

void SGDOptimizer::writeTo(ICheckpointWriter &archive) const
{
    _optim->save(toTorchArchive(archive));
}

void SGDOptimizer::readFrom(ICheckpointReader &archive)
{
    _optim->load(toTorchArchive(archive));
}