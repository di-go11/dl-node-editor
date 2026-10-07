#include "training/infrastructure/torchFunc/TorchIndexPoolingLayer.hpp"
#include "training/infrastructure/torchFunc/DeviceToTorch.hpp"

namespace
{
    torch::nn::MaxPool2d makeModule(const IndexedPoolingSpec &params)
    {
        return torch::nn::MaxPool2d(
            torch::nn::MaxPool2dOptions(params.kernelSize).stride(params.stride).padding(params.padding));
    }
}

TorchIndexPoolingLayer::TorchIndexPoolingLayer(const IndexedPoolingSpec &params) : _module(makeModule(params))
{
}

// 出力は nodePortsOf(IndexedPoolingSpec) の出力ポートの順: {y, indices}。
std::vector<at::Tensor> TorchIndexPoolingLayer::forward(const std::vector<at::Tensor> &inputs)
{
    auto [pooled, indices] = _module->forward_with_indices(inputs[0]);
    return {pooled, indices};
}

std::vector<at::Tensor> TorchIndexPoolingLayer::parameters() const
{
    return _module->parameters();
}

void TorchIndexPoolingLayer::setTrain(bool trainingMode)
{
    _module->train(trainingMode);
}

void TorchIndexPoolingLayer::to(const ComputeDevice &device)
{
    _module->to(training::infrastructure::torchFunc::deviceToTorch(device));
}
