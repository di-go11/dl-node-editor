#pragma once

#include "training/entities/domain-objects/ImageAnnotationType.hpp"

#include <variant>

// 画像アノテーション形式ごとの固有設定。LossConfig / OptimizerConfig と同じ
// std::variant 方式。学習タスク(検出/セグメンテーション)は形式ではなく学習の
// 目的なので AppConfig 側(TrainingTaskType)が持ち、ここには置かない。

struct PascalVocConfig
{
    // VOC の <difficult> フラグ付き物体を学習に含めるか。
    bool includeDifficult = false;
};

inline ImageAnnotationType annotationTypeOf(const PascalVocConfig &)
{
    return ImageAnnotationType::PASCAL_VOC;
}

// variant の並び順は ImageAnnotationType と対応させておく。
using ImageAnnotationConfig = std::variant<PascalVocConfig>;

inline ImageAnnotationType annotationTypeOf(const ImageAnnotationConfig &config)
{
    return std::visit(
        [](const auto &c) -> ImageAnnotationType
        {
            return annotationTypeOf(c);
        },
        config);
}
