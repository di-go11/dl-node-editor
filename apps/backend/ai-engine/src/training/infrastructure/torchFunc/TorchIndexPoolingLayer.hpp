#pragma once

#include "training/adapters/interfaces/ILayer.hpp"
#include "training/adapters/interfaces/IIndicesSource.hpp"
#include "training/entities/domain-objects/IndexedPoolingParams.hpp"

#include <torch/nn/modules/pooling.h>

class TorchIndexPoolingLayer : public ILayer, public IIndicesSource
{
public:
    explicit TorchIndexPoolingLayer(const IndexedPoolingParams &params);

    void forward(const at::Tensor &input, at::Tensor &output) override;
    std::vector<at::Tensor> parameters() const override;

    void setTrain(bool trainingMode) override;

    // 層の内部パラメータ・バッファを指定 device 上へ移動する。
    void to(const ComputeDevice &device) override;

    at::Tensor takeIndices() override;

private:
    torch::nn::MaxPool2d _module;
    at::Tensor _lastIndices;
};