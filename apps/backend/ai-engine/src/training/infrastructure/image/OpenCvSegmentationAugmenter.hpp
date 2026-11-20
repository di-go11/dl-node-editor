#pragma once

#include "training/application/interfaces/image/ISegmentationAugmenter.hpp"
#include "training/entities/image/AugmentationConfig.hpp"
#include "training/entities/image/ImageData.hpp"

#include <cstdint>

// segmentation の train 用の幾何拡張: 拡大縮小 → 余白 / 切り抜き → 左右反転。
// 出力サイズは入力と同じ W×H。画像は bilinear、マスクは nearest で補間する。
// 余白は画像を 0、マスクを ignoreIndex で埋める(余白を背景として学習させない)。
class OpenCvSegmentationAugmenter : public ISegmentationAugmenter
{
public:
    // 0 < scaleMin <= scaleMax でなければ std::invalid_argument。
    OpenCvSegmentationAugmenter(const AugmentationConfig &config, uint8_t ignoreIndex);

    void apply(ImageData &image, ImageData &mask, uint64_t sampleSeed) const override;

private:
    AugmentationConfig _config;
    uint8_t _ignoreIndex; // マスクの余白を埋める値
};
