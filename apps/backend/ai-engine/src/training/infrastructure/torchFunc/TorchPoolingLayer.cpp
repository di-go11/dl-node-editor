#include "training/infrastructure/torchFunc/TorchPoolingLayer.hpp"

TorchPoolingLayer::TorchPoolingLayer(const PoolingParams &params)
{
    if (params.type == PoolingType::Max)
    {
        _param = torch::nn::MaxPool2d(
            torch::nn::MaxPool2dOptions(params.kernelSize).stride(params.stride).padding(params.padding));
    }
    else if (params.type == PoolingType::Average)
    {
        _param = torch::nn::AvgPool2d(
            torch::nn::AvgPool2dOptions(params.kernelSize).stride(params.stride).padding(params.padding));
    }
}

void TorchPoolingLayer::forward(const at::Tensor &input, at::Tensor &output)
{
    output = std::visit([&input](auto &module)
                        { return module->forward(input); }, _param);
}