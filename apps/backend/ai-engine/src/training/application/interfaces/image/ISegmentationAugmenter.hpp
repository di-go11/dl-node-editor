#pragma once

#include "training/entities/image/ImageData.hpp"

#include <cstdint>

// セグメンテーション用のデータ拡張。画像とマスクに同じ幾何変換をかける。
// 並列に呼ばれるので、実装は状態を持たず、乱数は sampleSeed だけから決める
// (同じ sampleSeed なら、スレッド数に関係なく同じ結果になる)。
class ISegmentationAugmenter
{
public:
    virtual ~ISegmentationAugmenter() = default;
    // image: 入力画像(CHW)、mask: クラス ID のマスク(1×H×W)。H, W は両者で同じであること。
    virtual void apply(ImageData &image, ImageData &mask, uint64_t sampleSeed) const = 0;
};
