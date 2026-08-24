#include "training/infrastructure/torchFunc/headers/Sigmoid.hpp"

#include <torch/torch.h>

Sigmoid::Sigmoid() {}

void Sigmoid::activate(const at::Tensor &input, at::Tensor &output)
{
    output = torch::sigmoid(input);
}
