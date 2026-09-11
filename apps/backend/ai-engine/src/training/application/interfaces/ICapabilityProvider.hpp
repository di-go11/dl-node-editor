#pragma once

#include <string>
#include <vector>
#include "training/entities/domain-objects/ComputeDevice.hpp"

// 1台のデバイス情報(gRPCのDeviceInfo二対応する。生成コード非依存の値型)
struct DeviceSnapshot
{
    std::string name;
    ComputeDeviceType type;
    int index = 0;
};

// GetCapabilitiesの結果(gRPCのCapabilitiesResponseに対応)
struct CapabilitySnapshot
{
    bool cudaAvailable = false;
    std::vector<DeviceSnapshot> devices;
};

class ICapabilityProvider
{
public:
    virtual ~ICapabilityProvider() = default;
    virtual CapabilitySnapshot snapshot() const = 0;
};