#pragma once

#include <string>
#include <charconv>
#include <stdexcept>

enum class Devicetype
{
    Cpu,
    Cuda,
};

struct Device
{
    Devicetype type = Devicetype::Cuda;
    int index = 0; // Cudaの時のみ利用
};

inline Device parseDevice(const std::string &deviceStr)
{
    if (deviceStr == "cuda")
    {
        return Device{Devicetype::Cuda, 0};
    }
    else if (deviceStr == "cpu")
    {
        return Device{Devicetype::Cpu, 0};
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
            return Device{Devicetype::Cuda, cudaIndex};
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

inline std::string deviceToString(const Device &device)
{
    if (device.type == Devicetype::Cuda)
    {
        return "cuda:" + std::to_string(device.index);
    }
    else if (device.type == Devicetype::Cpu)
    {
        return "cpu";
    }
    else
    {
        throw std::runtime_error("Unknown device type");
    }
}