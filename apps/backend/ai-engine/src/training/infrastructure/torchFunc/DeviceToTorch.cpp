#include "training/infrastructure/torchFunc/DeviceToTorch.hpp"

#include <stdexcept>

namespace training::infrastructure::torchFunc
{
    torch::Device deviceToTorch(const Device &device)
    {
        if (device.type == Devicetype::Cpu)
        {
            return torch::Device(torch::kCPU);
        }
        else if (device.type == Devicetype::Cuda)
        {
            return torch::Device(torch::kCUDA, device.index);
        }
        else
        {
            throw std::invalid_argument("Unsupported device type");
        }
    }
}
