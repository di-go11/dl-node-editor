#include "training/infrastructure/torchFunc/MseLoss.hpp"

#include <torch/torch.h>

void MseLoss::lossOut(const at::Tensor &predicted, const at::Tensor &target, at::Tensor &output)
{
    output = torch::mse_loss(predicted, target);
}