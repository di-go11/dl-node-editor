#pragma once

#include "training/adapters/interfaces/ILayer.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/IndexedPoolingParams.hpp"

#include <torch/nn/modules/pooling.h>

class TorchIndexPoolingLayer : public ILayer
{
public:
    explicit TorchIndexPoolingLayer(const IndexedPoolingParams &params);

    std::vector<at::Tensor> forward(const std::vector<at::Tensor> &inputs) override;
    std::vector<at::Tensor> parameters() const override;

    void setTrain(bool trainingMode) override;

    // 層の内部パラメータ・バッファを指定 device 上へ移動する。
    void to(const ComputeDevice &device) override;

private:
    torch::nn::MaxPool2d _module;
};