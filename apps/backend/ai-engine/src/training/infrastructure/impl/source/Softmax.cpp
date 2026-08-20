#include "../header/Softmax.hpp"

#include <torch/torch.h>

Softmax::Softmax(int dim) : _dim(dim) {}
void Softmax::activate(const at::Tensor &input, at::Tensor &output)
{
    output = torch::softmax(input, /*dim=*/_dim);
}
