#include "training/infrastructure/torchFunc/TorchUnpoolingLayer.hpp"
#include "training/infrastructure/torchFunc/DeviceToTorch.hpp"

namespace
{
    torch::nn::MaxUnpool2d makeModule(const UnpoolingParams &params)
    {
        return torch::nn::MaxUnpool2d(
            torch::nn::MaxUnpool2dOptions(params.kernelSize).stride(params.stride).padding(params.padding));
    }
}

TorchUnpoolingLayer::TorchUnpoolingLayer(const UnpoolingParams &params) : _module(makeModule(params))
{
}

void TorchUnpoolingLayer::forward(const at::Tensor &input, at::Tensor &output)
{
    output = _module->forward(input, _indices);
}

std::vector<at::Tensor> TorchUnpoolingLayer::parameters() const
{
    return {}; // Unpoolingは学習パラメータを持たない。
}

void TorchUnpoolingLayer::setTrain(bool trainingMode)
{
    _module->train(trainingMode);
}

void TorchUnpoolingLayer::to(const ComputeDevice &device)
{
    _module->to(training::infrastructure::torchFunc::deviceToTorch(device));
}

void TorchUnpoolingLayer::provideIndices(const at::Tensor &indices)
{
    _indices = indices;
}