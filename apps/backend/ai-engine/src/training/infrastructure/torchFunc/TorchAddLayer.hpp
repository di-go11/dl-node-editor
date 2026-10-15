// 2つ以上のノードの出力(テンソル)を設定に合わせて結合する層。
// 戻り値は必ず、テンソル一つのベクター
// alpha: 加算するテンソルの値を係数

#pragma once

#include "training/adapters/interfaces/ILayer.hpp"

#include <torch/torch.h>
#include <vector>

class TorchAddLayer : public ILayer
{
public:
    explicit TorchAddLayer(float alpha);
    std::vector<at::Tensor> forward(const std::vector<at::Tensor> &inputs) override;
    std::vector<at::Tensor> parameters() const override;

    void setTrain(bool trainingMode) override;

    void to(const ComputeDevice &device) override;

private:
    float _alpha;
};