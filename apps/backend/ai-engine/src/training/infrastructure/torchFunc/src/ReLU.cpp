#include "training/infrastructure/torchFunc/header/ReLU.hpp"

#include <torch/torch.h>

ReLU::ReLU() {}

void ReLU::activate(const at::Tensor &input, at::Tensor &output)
{
    output = torch::relu(input);
}
