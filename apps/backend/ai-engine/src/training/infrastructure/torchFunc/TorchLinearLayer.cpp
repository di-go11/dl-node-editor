#include "training/infrastructure/torchFunc/TorchLinearLayer.hpp"

TorchLinearLayer::TorchLinearLayer(const LinearParams &params) : _module(torch::nn::LinearOptions(params.inFeatures, params.outFeatures).bias(params.bias)) {}

void TorchLinearLayer::forward(const at::Tensor &input, at::Tensor &output)
{
    output = _module->forward(input);
}

std::vector<at::Tensor> TorchLinearLayer::parameters() const
{
    return _module->parameters();
}

void TorchLinearLayer::setTrain(bool trainingMode)
{
    _module->train(trainingMode);
}