#include "training/infrastructure/torchFunc/TorchPoolingLayer.hpp"
#include "training/infrastructure/torchFunc/DeviceToTorch.hpp"

namespace
{
    std::variant<torch::nn::MaxPool2d, torch::nn::AvgPool2d> makeModule(const PoolingParams &params)
    {
        if (params.type == PoolingType::Max)
        {
            return torch::nn::MaxPool2d(
                torch::nn::MaxPool2dOptions(params.kernelSize).stride(params.stride).padding(params.padding));
        }
        return torch::nn::AvgPool2d(
            torch::nn::AvgPool2dOptions(params.kernelSize).stride(params.stride).padding(params.padding));
    }
} // namespace

TorchPoolingLayer::TorchPoolingLayer(const PoolingParams &params) : _module(makeModule(params))
{
}

void TorchPoolingLayer::forward(const at::Tensor &input, at::Tensor &output)
{
    output = std::visit([&input](auto &module)
                        { return module->forward(input); }, _module);
}

std::vector<at::Tensor> TorchPoolingLayer::parameters() const
{
    return std::visit([](auto &module)
                       { return module->parameters(); }, _module);
}

void TorchPoolingLayer::setTrain(bool trainingMode)
{
    std::visit([trainingMode](auto &module)
               { module->train(trainingMode); }, _module);
}

void TorchPoolingLayer::to(const ComputeDevice &device)
{
    // Pooling は学習パラメータ・buffer を持たないため実質 no-op だが、
    // 一貫性のため module にも転送する。
    const torch::Device torchDevice = training::infrastructure::torchFunc::deviceToTorch(device);
    std::visit([torchDevice](auto &module)
               { module->to(torchDevice); }, _module);
}