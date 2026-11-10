#include "TorchConcatLayer.hpp"

#include "training/entities/domain-objects/ModelGraph/Layers/ConcatSpec.hpp"

#include <cstdint>

namespace
{
    // libtorch の特徴マップは NCHW なので、チャンネルは 1 番目の次元。
    // テンソルの並び方は libtorch の都合なので、この知識は infrastructure 側だけに置く。
    constexpr int64_t kChannelDim = 1;
}

TorchConcatLayer::TorchConcatLayer(const ConcatSpec &)
{
}

std::vector<at::Tensor> TorchConcatLayer::forward(const std::vector<at::Tensor> &inputs)
{
    return {at::cat(inputs, kChannelDim)};
}

// Concat は学習パラメータを持たないので、何も返さない
std::vector<at::Tensor> TorchConcatLayer::parameters() const
{
    return {};
}

void TorchConcatLayer::setTrain(bool)
{
}

// Concat は学習パラメータを持たないので、device を指定する必要はない
void TorchConcatLayer::to(const ComputeDevice &)
{
}
