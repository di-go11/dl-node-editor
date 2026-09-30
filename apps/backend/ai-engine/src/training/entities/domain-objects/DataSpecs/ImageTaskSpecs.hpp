// 画像タスクごとの仕様定義

#pragma once

#include <cstdint>
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
};

using ImageTaskSpecs = std::variant<SegmentationSpec, ObjectDetectionSpec, ClassificationSpec>;