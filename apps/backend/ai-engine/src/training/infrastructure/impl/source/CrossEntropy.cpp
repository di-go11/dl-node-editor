#include "src/training/infrastructure/impl/header/CrossEntropy.hpp"

#include <torch/torch.h>

CrossEntropy::CrossEntropy() {}
void CrossEntropy::lossOut(const torch::Tensor &predicted, const torch::Tensor &target, torch::Tensor &output)
{
    output = torch::nn::functional::cross_entropy(predicted, target);
}