#pragma once

#include "training/adapters/interfaces/ILearningRateScheduler.hpp"

#include <cstdint>

class StepLR : public ILearningRateScheduler
{
public:
    // stepSize: 何ステップごとに gamma を掛けるか(ステップの単位は updateInterval に従う。1 以上)
    StepLR(uint64_t stepSize, double initialLR, double gamma, LearningRateUpdateInterval updateInterval);
    double learningRateAt(uint64_t step) const override;
    LearningRateUpdateInterval getUpdateInterval() const override { return _updateInterval; }

private:
    const uint64_t _stepSize;
    const double _initialLR;
    const double _gamma;
    const LearningRateUpdateInterval _updateInterval;
};
