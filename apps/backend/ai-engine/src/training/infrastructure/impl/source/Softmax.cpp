#include "../header/Softmax.hpp"

#include <torch/torch.h>

Softmax::Softmax() {}

void Softmax::activate(const at::Tensor &input, at::Tensor &output)
{
    output = torch::softmax(input, /*dim=*/1);
}
