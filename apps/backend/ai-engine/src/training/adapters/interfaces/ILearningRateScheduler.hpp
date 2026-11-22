#pragma once

#include "training/adapters/impl/LearningRateSchedulerType.hpp"
#include <cstdint>

class ILearningRateScheduler
{
public:
    virtual ~ILearningRateScheduler() = default;

    virtual double learningRateAt(uint64_t step) const = 0;
    virtual LearningRateSchedulerType getType() const = 0; // 学習率スケジューラの種類を返す。(oneBatch / oneEpoch)
};