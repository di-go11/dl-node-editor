#include "training/infrastructure/torchFunc/headers/Tanh.hpp"

#include <torch/torch.h>

Tanh::Tanh() {}

void Tanh::activate(const at::Tensor &input, at::Tensor &output)
{
    output = torch::tanh(input);
}
