#pragma once

#include "training/entities/domain-objects/Device.hpp"

#include <torch/torch.h>

namespace training::infrastructure::torchFunc
{
    torch::Device deviceToTorch(const Device &device);
}