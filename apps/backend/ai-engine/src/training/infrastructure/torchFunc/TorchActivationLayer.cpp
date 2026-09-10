#include "training/infrastructure/torchFunc/TorchActivationLayer.hpp"
#include "training/infrastructure/torchFunc/ReLU.hpp"
#include "training/infrastructure/torchFunc/Sigmoid.hpp"
#include "training/infrastructure/torchFunc/Softmax.hpp"
#include "training/infrastructure/torchFunc/Tanh.hpp"

#include <torch/torch.h>

TorchActivationLayer::TorchActivationLayer(const ActivationParams &params)
{
    switch (params.activationType)
    {
    case ActivationType::ReLU:
        _activation = std::make_shared<ReLU>();
        break;
    case ActivationType::Sigmoid:
        _activation = std::make_shared<Sigmoid>();
        break;
    case ActivationType::Softmax:
        _activation = std::make_shared<Softmax>(params.dim);
        break;
    case ActivationType::Tanh:
        _activation = std::make_shared<Tanh>();
        break;

    default:
        break;
    }
}

void TorchActivationLayer::forward(const at::Tensor &input, at::Tensor &output)
{
    _activation->activate(input, output);
}

std::vector<at::Tensor> TorchActivationLayer::parameters() const
{
    return {};
}

void TorchActivationLayer::setTrain(bool /*trainingMode*/)
{
    // 活性化層は状態を持たないため train/eval の切替は不要
}

void TorchActivationLayer::to(const ComputeDevice & /*device*/)
{
    // 活性化層は学習パラメータ・buffer を持たないため device 移動は不要
    // (出力テンソルは入力と同じ device 上に生成される)
}