#pragma once

#include "training/entities/domain-objects/Optimizer/LearningRateSchedulerConfig.hpp"
#include <cstdint>

class ILearningRateScheduler
{
public:
    virtual ~ILearningRateScheduler() = default;

    // step: 学習開始から何回目の更新か(0 始まり)。数え方の単位は getUpdateInterval() に従う。
    virtual double learningRateAt(uint64_t step) const = 0;
    virtual LearningRateUpdateInterval getUpdateInterval() const = 0; // 学習率を何ごとに更新するか(PerBatch / PerEpoch)
};
