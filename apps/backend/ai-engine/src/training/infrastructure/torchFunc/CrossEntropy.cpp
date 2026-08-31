#include "training/infrastructure/torchFunc/CrossEntropy.hpp"

#include <torch/torch.h>

CrossEntropy::CrossEntropy() {}
void CrossEntropy::lossOut(const torch::Tensor &predicted, const torch::Tensor &target, torch::Tensor &output)
{
    namespace F = torch::nn::functional;
    output = F::cross_entropy(
        predicted, target, F::CrossEntropyFuncOptions().ignore_index(255));
}