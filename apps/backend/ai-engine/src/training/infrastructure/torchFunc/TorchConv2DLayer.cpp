#include "training/infrastructure/torchFunc/TorchConv2DLayer.hpp"

TorchConv2DLayer::TorchConv2DLayer(const Conv2DParams &params) : _module(torch::nn::Conv2dOptions(params.inChannels, params.outChannels, params.kernelSize).stride(params.stride).padding(params.padding)) {}

void TorchConv2DLayer::forward(const at::Tensor &input, at::Tensor &output)
{
    output = _module->forward(input);
}

std::vector<at::Tensor> TorchConv2DLayer::parameters() const
{
    return _module->parameters();
}