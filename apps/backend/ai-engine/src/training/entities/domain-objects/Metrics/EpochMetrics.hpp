#pragma once

#include "TaskMetrics.hpp"

struct EpochMetrics
{
    double loss; // データセット全体の平均 loss(ピクセル単位): Min
    TaskMetrics taskMetrics;
};