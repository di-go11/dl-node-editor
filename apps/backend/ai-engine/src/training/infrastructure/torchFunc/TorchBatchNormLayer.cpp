#include "training/infrastructure/torchFunc/TorchBatchNormLayer.hpp"
#include "training/infrastructure/torchFunc/DeviceToTorch.hpp"

TorchBatchNormLayer::TorchBatchNormLayer(const BatchNormParams &params) : _module(torch::nn::BatchNormOptions(params.numFeatures).eps(params.eps).momentum(params.momentum)) {}

std::vector<at::Tensor> TorchBatchNormLayer::forward(const std::vector<at::Tensor> &inputs)
{
    return {_module->forward(inputs[0])};
}

std::vector<at::Tensor> TorchBatchNormLayer::parameters() const
{
    return _module->parameters();
}

void TorchBatchNormLayer::setTrain(bool trainingMode)
{
    _module->train(trainingMode);
}

void TorchBatchNormLayer::to(const ComputeDevice &device)
{
    // running_mean / running_var などの buffer も含めて移動する
    _module->to(training::infrastructure::torchFunc::deviceToTorch(device));
}