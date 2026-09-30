// データ形式による仕様の定義(現在画像タスクのみ)

#pragma once

#include "training/entities/domain-objects/ImageAnnotationConfig.hpp"
#include "training/entities/domain-objects/DataSpecs/ImageTaskSpecs.hpp"

#include <variant>
#include <cstddef>

struct ImageSpec
{
    ImageAnnotationConfig annotation;
    size_t inputWidth = 256; // 画像にしかない
    size_t inputHeight = 256;
    ImageTaskSpecs taskSpecs;
};

using DataSpec = std::variant<ImageSpec>;