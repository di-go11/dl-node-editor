#include "training/infrastructure/torchFunc/DeviceToTorch.hpp"

#include <stdexcept>

#include <torch/torch.h>

namespace training::infrastructure::torchFunc
{
    torch::Device deviceToTorch(const ComputeDevice &device)
    {
        if (device.type == ComputeDeviceType::Cpu)
        {
            return torch::Device(torch::kCPU);
        }
        else if (device.type == ComputeDeviceType::Cuda)
        {
            return torch::Device(torch::kCUDA, device.index);
        }
        else
        {
            throw std::invalid_argument("Unsupported device type");
        }
    }

    void ensureComputeDeviceAvailable(const ComputeDevice &device)
    {
        if (device.type != ComputeDeviceType::Cuda)
        {
            return;
        }

        if (!torch::cuda::is_available())
        {
            throw std::runtime_error(
                "device = " + computeDeviceToString(device) +
                " was requested but CUDA is not available. "
                "Check that libtorch is a CUDA build and that the GPU driver is "
                "visible from the container (run `nvidia-smi`). "
                "To run on CPU, set `device = cpu` in .config.");
        }

        if (device.index >= static_cast<int64_t>(torch::cuda::device_count()))
        {
            throw std::runtime_error(
                "device = " + computeDeviceToString(device) +
                " was requested but this machine has only " +
                std::to_string(torch::cuda::device_count()) + " CUDA device(s).");
        }
    }
}
