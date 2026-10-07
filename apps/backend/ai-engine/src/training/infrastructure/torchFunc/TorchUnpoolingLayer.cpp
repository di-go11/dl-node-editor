#include "training/infrastructure/torchFunc/TorchUnpoolingLayer.hpp"
#include "training/infrastructure/torchFunc/DeviceToTorch.hpp"

namespace
{
    torch::nn::MaxUnpool2d makeModule(const UnpoolingSpec &params)
    {
        return torch::nn::MaxUnpool2d(
            torch::nn::MaxUnpool2dOptions(params.kernelSize).stride(params.stride).padding(params.padding));
    }
}

TorchUnpoolingLayer::TorchUnpoolingLayer(const UnpoolingSpec &params) : _module(makeModule(params))
{
}

// 入力は nodePortsOf(UnpoolingSpec) の入力ポートの順: {x, indices}。
std::vector<at::Tensor> TorchUnpoolingLayer::forward(const std::vector<at::Tensor> &inputs)
{
    return {_module->forward(inputs[0], inputs[1])};
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
