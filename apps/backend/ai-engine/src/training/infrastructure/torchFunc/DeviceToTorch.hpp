#pragma once

#include "training/entities/domain-objects/Device.hpp"

#include <torch/torch.h>

namespace training::infrastructure::torchFunc
{
    static torch::Device convert(const Device &device);
}