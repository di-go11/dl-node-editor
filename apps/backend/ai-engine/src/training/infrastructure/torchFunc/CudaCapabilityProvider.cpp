#include "training/infrastructure/torchFunc/CudaCapabilityProvider.hpp"
#include <torch/torch.h>

CapabilitySnapshot CudaCapabilityProvider::snapshot() const
{
    CapabilitySnapshot snap;
    snap.cudaAvailable = torch::cuda::is_available();

    // CPUは常に使える前提で1件入れる。

    snap.devices.push_back(DeviceSnapshot{"cpu", ComputeDeviceType::Cpu, 0});
    const auto count = static_cast<int64_t>(torch::cuda::device_count());

    if (snap.cudaAvailable)
    {
        for (int64_t i = 0; i < count; i++)
        {
            snap.devices.push_back(
                DeviceSnapshot{"cuda:" + std::to_string(i), ComputeDeviceType::Cuda, static_cast<int>(i)});
        }
    }
    return snap;
}