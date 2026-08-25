#include "training/infrastructure/torchFunc/TorchActivationLayer.hpp"
#include "training/infrastructure/torchFunc/ReLU.hpp"
#include "training/infrastructure/torchFunc/Sigmoid.hpp"
#include "training/infrastructure/torchFunc/Softmax.hpp"
#include "training/infrastructure/torchFunc/Tanh.hpp"

TorchActivationLayer::TorchActivationLayer(const ActivationParams &params)
{
    switch (params.activationType)
    {
    case ActivationType::ReLU:
        _activation = std::make_shared<ReLU>();
        break;

    default:
        break;
    }
}

void TorchActivationLayer::forward(const at::Tensor &input, at::Tensor &output)
{
    output =
}