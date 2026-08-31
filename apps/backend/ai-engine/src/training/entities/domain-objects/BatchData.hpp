#pragma once

#include <vector>

// 学習バッチ1つ分のサンプル列。
// TSample は用途で変わる:
//   - 入力(input): NormalizedImageData(0.0-1.0 に正規化済み, float)
//   - ターゲット(target): ImageData(クラスIDなど生の値, uint8_t)
template <typename TSample>
struct BatchData
{
    std::vector<TSample> values;
    int num_samples = 0;
};
