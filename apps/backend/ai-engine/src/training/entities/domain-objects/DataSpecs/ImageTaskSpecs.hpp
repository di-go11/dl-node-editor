// 画像タスクごとの仕様定義

#pragma once

#include "training/entities/image/RgbColor.hpp"

#include <cstdint>
#include <optional>
#include <variant>

struct ObjectDetectionSpec
{
    /* data */
};

struct ClassificationSpec
{
    /* data */
};

struct SegmentationSpec
{
    uint8_t ignoreIndex = 255;
    // マスク画像でこの色のピクセルを ignoreIndex に変換する(Pascal VOC の void は 224,224,192)。
    // nullopt なら、labelmap にない色はすべてエラーにする。
    std::optional<RgbColor> ignoreColor;
};

using ImageTaskSpecs = std::variant<SegmentationSpec, ObjectDetectionSpec, ClassificationSpec>;