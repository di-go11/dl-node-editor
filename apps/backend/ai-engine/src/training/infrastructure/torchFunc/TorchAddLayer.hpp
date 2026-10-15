// 2つ以上のノードの出力(テンソル)を要素ごとに足し合わせる層(形は変わらない)。
// 戻り値は必ず、テンソル一つのベクター
// alpha: 2番目以降の入力にかける係数(sum = x0 + alpha * x1 + alpha * x2 ...)

#pragma once

#include "training/entities/domain-objects/ModelGraph/Layers/AddSpec.hpp"
#include "training/adapters/interfaces/ILayer.hpp"

#include <torch/torch.h>
#include <vector>

class TorchAddLayer : public ILayer
{
public:
    explicit TorchAddLayer(const AddSpec &params);
    std::vector<at::Tensor> forward(const std::vector<at::Tensor> &inputs) override;
    std::vector<at::Tensor> parameters() const override;

    void setTrain(bool trainingMode) override;

    void to(const ComputeDevice &device) override;

private:
    double _alpha;
};