#include "training/infrastructure/torchFunc/TorchLinearLayer.hpp"
#include "training/infrastructure/torchFunc/DeviceToTorch.hpp"

TorchLinearLayer::TorchLinearLayer(const LinearParams &params) : _module(torch::nn::LinearOptions(params.inFeatures, params.outFeatures).bias(params.bias)) {}

std::vector<at::Tensor> TorchLinearLayer::forward(const std::vector<at::Tensor> &inputs)
{
    return {_module->forward(inputs[0])};
}

std::vector<at::Tensor> TorchLinearLayer::parameters() const
{
    return _module->parameters();
}

void TorchLinearLayer::setTrain(bool trainingMode)
{
    _module->train(trainingMode);
}

void TorchLinearLayer::to(const ComputeDevice &device)
{
    _module->to(training::infrastructure::torchFunc::deviceToTorch(device));
}