#pragma once

#include "training/entities/domain-objects/ImageAnnotationType.hpp"

#include <variant>

// 画像アノテーション形式ごとの固有設定。LossConfig / OptimizerConfig と同じ
// std::variant 方式。学習タスク(検出/セグメンテーション)は形式ではなく学習の
// 目的なので ImageSpec 側(ImageTaskSpecs)が持ち、ここには置かない。

// 形式はどちらも VOC と同じディレクトリ構成(JPEGImages / ImageSets / SegmentationClass)を読む。
// 違うのはマスクの色とクラスの対応をどこから取るか(loadDatasetLabelMap を参照)。

// 本家 PASCAL VOC。マスクの色は VOC のカラーマップ(21 クラス固定)で解釈し、labelmap.txt は読まない。
struct PascalVocConfig
{
    // VOC の <difficult> フラグ付き物体を学習に含めるか。
    bool includeDifficult = false;
};

// 独自形式(CVAT の Segmentation mask 書き出しなど)。色とクラスの対応は labelmap.txt で決める。
struct OriginalConfig
{
};

// variant の並び順は ImageAnnotationType と対応させておく。
using ImageAnnotationConfig = std::variant<PascalVocConfig, OriginalConfig>;