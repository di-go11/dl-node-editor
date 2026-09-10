#pragma once

#include "training/entities/domain-objects/ComputeDevice.hpp"

#include <torch/torch.h>

namespace training::infrastructure::torchFunc
{
    torch::Device deviceToTorch(const ComputeDevice &device);

    void ensureComputeDeviceAvailable(const ComputeDevice &device);
}