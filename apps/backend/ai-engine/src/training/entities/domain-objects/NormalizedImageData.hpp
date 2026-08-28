#pragma once

#include <vector>
#include <cstddef>

// ImageData(生ピクセル、uint8_t)を0.0-1.0に正規化した後のデータ。
// 学習の入力(input)として使う際はこちらを使う。クラスIDを保持するマスク(target)には
// 正規化は適用しないため、target側は引き続きImageDataのまま扱うこと。
struct NormalizedImageData
{
    std::vector<size_t> shape; // 1サンプル分の形状。例: {channels, height, width}
    std::vector<float> values; // 0.0-1.0に正規化された値
};
