#include "TorchAddLayer.hpp"

TorchAddLayer::TorchAddLayer(const AddSpec &params) : _alpha(params.alpha)
{
}

std::vector<at::Tensor> TorchAddLayer::forward(const std::vector<at::Tensor> &inputs)
{
    at::Tensor sum = inputs[0];

    for (std::size_t i = 1; i < inputs.size(); ++i)
    {
        sum = torch::add(sum, inputs[i], _alpha);
    }

    return {sum};
}

std::vector<at::Tensor> TorchAddLayer::parameters() const
{
    return {};
}

void TorchAddLayer::setTrain(bool)
{
}

void TorchAddLayer::to(const ComputeDevice &)
{
}
