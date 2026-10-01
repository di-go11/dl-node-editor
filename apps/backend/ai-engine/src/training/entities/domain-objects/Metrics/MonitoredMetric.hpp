#pragma once
#include "TaskMetrics.hpp"
#include "MetricMode.hpp"
#include "training/entities/utils/Overloaded.hpp"

#include <string>
#include <variant>
#include <vector>

struct MonitoredMetric
{
    std::string name;
    double value;    // モニタリング対象のメトリック値
    MetricMode mode; // Max / Min
};

inline MonitoredMetric monitoredMetric(const TaskMetrics &m)
{
    return std::visit(Overloaded{
                          [](const SegmentationMetricsConfig &s)
                          {
                              return MonitoredMetric{"meanIoU", s.meanIoU, MetricMode::Max};
                          },
                          [](const ClassificationMetricsConfig &c)
                          {
                              return MonitoredMetric{
                                  "accuracy", c.accuracy, MetricMode::Max};
                          },
                      },
                      m);
};

// クラスごとの値を "v0, v1, ..." の形に並べる(インデックス = クラス番号)
inline std::string joinPerClass(const std::vector<double> &values)
{
    std::string joined;
    for (size_t i = 0; i < values.size(); ++i)
    {
        if (i > 0)
        {
            joined += ", ";
        }
        joined += std::to_string(values[i]);
    }
    return joined;
}

// ログ用の文字列
inline std::string describe(const TaskMetrics &m)
{
    return std::visit(Overloaded{
                          [](const SegmentationMetricsConfig &s)
                          {
                              return "SegmentationMetricsConfig{pixelAccuracy: " + std::to_string(s.pixelAccuracy) +
                                     ", meanIoU: " + std::to_string(s.meanIoU) +
                                     ", fwIoU: " + std::to_string(s.fwIoU) +
                                     ", meanClassAccuracy: " + std::to_string(s.meanClassAccuracy) +
                                     ", perClassIoU: [" + joinPerClass(s.perClassIoU) + "]}";
                          },
                          [](const ClassificationMetricsConfig &c)
                          {
                              return "ClassificationMetricsConfig{accuracy: " + std::to_string(c.accuracy) +
                                     ", macroF1: " + std::to_string(c.macroF1) +
                                     ", perClassAccuracy: [" + joinPerClass(c.perClassAccuracy) + "]}";
                          },
                      },
                      m);
}