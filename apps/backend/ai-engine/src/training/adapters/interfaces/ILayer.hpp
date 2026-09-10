#pragma once

#include "training/entities/domain-objects/ComputeDevice.hpp"

#include <vector>

namespace at
{
    class Tensor;
}

class ILayer
{
public:
    virtual ~ILayer() = default;
    virtual void forward(const at::Tensor &input, at::Tensor &output) = 0;
    virtual std::vector<at::Tensor> parameters() const = 0;

    virtual void setTrain(bool trainingMode) = 0;

    // 層の内部パラメータ・バッファを指定 device 上へ移動する。
    virtual void to(const ComputeDevice &device) = 0;
};