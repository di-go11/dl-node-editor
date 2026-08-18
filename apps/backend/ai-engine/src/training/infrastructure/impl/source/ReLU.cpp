#include "../header/ReLU.hpp"

#include <torch/torch.h>

namespace torchF = torch::nn::functional;

ReLU::ReLU() {}

void ReLU::activate(const torch::Tensor &input, torch::Tensor &output)
{
}
