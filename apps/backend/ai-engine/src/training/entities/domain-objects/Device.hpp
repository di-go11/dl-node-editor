#pragma once

enum class DeviceKind
{
    Cpu,
    Cuda,
};

struct Device
{
    DeviceKind kind = DeviceKind::Cuda;
    int index = 0; // Cudaの時のみ利用
};