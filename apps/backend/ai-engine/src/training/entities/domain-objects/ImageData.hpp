#pragma once

#include <vector>
#include <cstddef>
#include <cstdint>

struct ImageData
{
    std::vector<size_t> shape;   // 1サンプル分の形状。例: {channels, height, width}
    std::vector<uint8_t> values; // 1サンプル分の生ピクセルデータ(0-255)。学習用のfloat化・正規化は別責務(ImageNormalizer/BatchTensorConverter)で行う
};
