#include "training/infrastructure/torchFunc/DeviceToTorch.hpp"

torch::Device DeviceToTorch::convert(const Device &device)
{
    if (device.getType() == DeviceType::CPU)
    {
        return torch::Device(torch::kCPU);
    }
    else if (device.getType() == DeviceType::CUDA)
    {
        return torch::Device(torch::kCUDA, device.getIndex());
    }
    else
    {
        throw std::invalid_argument("Unsupported device type");
    }
}