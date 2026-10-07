#include "training/infrastructure/torchFunc/TorchConv2DLayer.hpp"
#include "training/infrastructure/torchFunc/DeviceToTorch.hpp"

TorchConv2DLayer::TorchConv2DLayer(const Conv2DSpec &params) : _module(torch::nn::Conv2dOptions(params.inChannels, params.outChannels, params.kernelSize).stride(params.stride).padding(params.padding).dilation(params.dilation)) {}

std::vector<at::Tensor> TorchConv2DLayer::forward(const std::vector<at::Tensor> &inputs)
{
    return {_module->forward(inputs[0])};
}

std::vector<at::Tensor> TorchConv2DLayer::parameters() const
{
    return _module->parameters();
}

void TorchConv2DLayer::setTrain(bool trainingMode)
{
    _module->train(trainingMode);
}

void TorchConv2DLayer::to(const ComputeDevice &device)
{
    _module->to(training::infrastructure::torchFunc::deviceToTorch(device));
}