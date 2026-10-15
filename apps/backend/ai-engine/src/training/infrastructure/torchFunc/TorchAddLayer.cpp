#include "TorchAddLayer.hpp"

TorchAddLayer::TorchAddLayer(float alpha) : _alpha(alpha)
{
}

std::vector<at::Tensor> TorchAddLayer::forward(const std::vector<at::Tensor> &inputs)
{
    at::Tensor tempAddedTensor = inputs[0];
    std::vector<at::Tensor> result;

    for (int i = 1; i < inputs.size(); i++)
    {
        tempAddedTensor = torch::add(tempAddedTensor, inputs[i], _alpha);
    }

    result.push_back(tempAddedTensor);

    return result;
}

std::vector<at::Tensor> TorchAddLayer::parameters() const
{
}

void TorchAddLayer::setTrain(bool trainingMode)
{
}

void TorchAddLayer::to(const ComputeDevice &device)
{
}