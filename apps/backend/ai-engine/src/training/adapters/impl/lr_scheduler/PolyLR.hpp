#pragma once
#include "training/adapters/interfaces/ILearningRateScheduler.hpp"

class PolyLR : public ILearningRateScheduler
{
public:
    PolyLR(uint64_t totalSteps, double baseLR, double power, LearningRateUpdateInterval updateInterval);

    double learningRateAt(uint64_t step) const override;
    LearningRateUpdateInterval getUpdateInterval() const override { return _updateInterval; }

private:
    const double _baseLR;
    const uint64_t _totalSteps;
    const double _power;
    const LearningRateUpdateInterval _updateInterval;
};
