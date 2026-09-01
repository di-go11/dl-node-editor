#include "training/infrastructure/torchFunc/TorchPoolingLayer.hpp"

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