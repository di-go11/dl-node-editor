#pragma once

struct CheckpointMeta
{
    unsigned int epoch = 0;
    double bestMetric = 0.0;
    // MetricModeはtracker側の設定と一致させる。(or ここで待つ)
};