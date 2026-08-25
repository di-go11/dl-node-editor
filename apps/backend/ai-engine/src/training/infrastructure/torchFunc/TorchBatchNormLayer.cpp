#include "training/infrastructure/torchFunc/TorchBatchNormLayer.hpp"

TorchBatchNormLayer::TorchBatchNormLayer(const BatchNormParams &params) : _module(torch::nn::BatchNormOptions(params.numFeatures).eps(params.eps).momentum(params.momentum)) {}

void TorchBatchNormLayer::forward(const at::Tensor &input, at::Tensor &output)
{
    output = _module->forward(input);
}