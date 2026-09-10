#pragma once

#include <string>
#include <charconv>
#include <stdexcept>

// 計算デバイス(CPU / CUDA)を表すドメイン値。
// libtorch の c10::Device とグローバル名前空間で衝突しないよう、型名を
// ComputeDevice としている(このリポジトリの entity は名前空間を使わない方針のため)。
enum class ComputeDeviceType
{
    Cpu,
    Cuda,
};

struct ComputeDevice
{
    ComputeDeviceType type = ComputeDeviceType::Cuda;
    int index = 0; // Cudaの時のみ利用
};

inline ComputeDevice parseComputeDevice(const std::string &deviceStr)
{
    if (deviceStr == "cuda")
    {
        return ComputeDevice{ComputeDeviceType::Cuda, 0};
    }
    else if (deviceStr == "cpu")
    {
        return ComputeDevice{ComputeDeviceType::Cpu, 0};
    }

    const auto colon = deviceStr.find(':');
    if (colon != std::string::npos && deviceStr.substr(0, colon) == "cuda") // "cuda:"で始まる場合
    {
        int cudaIndex = 0;
        const char *first = deviceStr.data() + colon + 1;
        const char *last = deviceStr.data() + deviceStr.size();
        auto [ptr, ec] = std::from_chars(first, last, cudaIndex); // cudaIndexを参照渡しするためcudaIndexに変換した数値がそのまま入る
        if (ec == std::errc() && ptr == last && cudaIndex >= 0)
        {
            return ComputeDevice{ComputeDeviceType::Cuda, cudaIndex};
        }
        else
        {
            throw std::runtime_error("Invalid device string: " + deviceStr);
        }
    }
    else
    {
        throw std::runtime_error("Unknown device type: " + deviceStr);
    }
}

inline std::string computeDeviceToString(const ComputeDevice &device)
{
    if (device.type == ComputeDeviceType::Cuda)
    {
        return "cuda:" + std::to_string(device.index);
    }
    else if (device.type == ComputeDeviceType::Cpu)
    {
        return "cpu";
    }
    else
    {
        throw std::runtime_error("Unknown device type");
    }
}
