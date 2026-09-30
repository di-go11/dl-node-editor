#pragma once

#include <variant>
#include <vector>

struct SegmentationMetricsConfig
{
    double pixelAccuracy;     // 正解ピクセル / 総ピクセル: Max
    double meanIoU;           // クラスごとの IoU の平均値(画素が存在するクラスのみ。背景(クラス0)は除く): Max
    double fwIoU;             // クラスの出現頻度で重み付けした IoU: Max
    double meanClassAccuracy; // クラスごとの accuracy(TP / (TP + FN))の平均: Max
    std::vector<double> perClassIoU; // 背景を含む全クラス分。画素が存在しないクラスは NaN
};

struct ClassificationMetricsConfig
{
    double accuracy, macroF1; // top-k は将来拡張
    std::vector<double> perClassAccuracy;
};

using TaskMetrics = std::variant<
    SegmentationMetricsConfig,
    ClassificationMetricsConfig>;
