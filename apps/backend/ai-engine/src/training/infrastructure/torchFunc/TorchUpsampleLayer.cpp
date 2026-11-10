#include "TorchUpsampleLayer.hpp"
#include "DeviceToTorch.hpp"

namespace
{
    torch::nn::Upsample makeModule(const UpsampleSpec &specs)
    {
        const double scale = static_cast<double>(specs.scaleFactor);
        torch::nn::UpsampleOptions options;
        options.scale_factor(std::vector<double>{scale, scale}); // 高さ、幅の順

        switch (specs.upsampleMode)
        {
        case UpsampleMode::Bilinear:
            options.mode(torch::kBilinear).align_corners(false);
            break;

        case UpsampleMode::Nearest:
            options.mode(torch::kNearest);
            break;
        }
        return torch::nn::Upsample(options);
    }
}

TorchUpsampleLayer::TorchUpsampleLayer(const UpsampleSpec &specs) : _module(makeModule(specs))
{
}

std::vector<at::Tensor> TorchUpsampleLayer::forward(const std::vector<at::Tensor> &inputs)
{
    return {_module->forward(inputs[0])};
}

std::vector<at::Tensor> TorchUpsampleLayer::parameters() const
{
    return _module->parameters();
}

void TorchUpsampleLayer::setTrain(bool trainingMode)
{
    _module->train(trainingMode);
}

void TorchUpsampleLayer::to(const ComputeDevice &device)
{
    const torch::Device torchDevice = training::infrastructure::torchFunc::deviceToTorch(device);
    _module->to(torchDevice);
}