#pragma once

#include "SegmentationMetricsConfig.hpp"

#include <variant>

using MetricsConfig = std::variant<
    SegmentationMetricsConfig>;