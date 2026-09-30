#pragma once
#include "TaskMetrics.hpp"
#include "MetricMode.hpp"
#include "training/entities/utils/Overloaded.hpp"

#include <string>
#include <variant>

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
                                     ", perClassIoU: [" + (s.perClassIoU.empty() ? "" : std::to_string(s.perClassIoU[0])) +
                                     (s.perClassIoU.size() > 1 ? ", ..." : "") + "]}";
                          },
                          [](const ClassificationMetricsConfig &c)
                          {
                              return "ClassificationMetricsConfig{accuracy: " + std::to_string(c.accuracy) +
                                     ", macroF1: " + std::to_string(c.macroF1) +
                                     ", perClassAccuracy: [" + (c.perClassAccuracy.empty() ? "" : std::to_string(c.perClassAccuracy[0])) +
                                     (c.perClassAccuracy.size() > 1 ? ", ..." : "") + "]}";
                          },
                      },
                      m);
}