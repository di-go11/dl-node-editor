#pragma once

#include <variant>
#include <vector>

struct SegmentationMetricsConfig
{
    double pixelAccuracy, /* 正解ピクセル / 総ピクセル: Max */ meanIoU, /*クラスごとのIoUの平均値(有効クラス(backendは除く)のみ: Max*/ fwIoU, /*クラスの出現頻度で重み付けしたIoU: Max*/ meanClassIoU /*クラスごとのaccuracyを平均: Max*/;
    std::vector<double> perClassIoU;
};

struct ClassificationMetricsConfig
{
    double accuracy, macroF1; // top-k は将来拡張
    std::vector<double> perClassAccuracy;
};

using TaskMetrics = std::variant<
    SegmentationMetricsConfig,
    ClassificationMetricsConfig>;
