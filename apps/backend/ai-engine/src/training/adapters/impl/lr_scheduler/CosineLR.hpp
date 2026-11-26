#pragma once

#include "training/adapters/interfaces/ILearningRateScheduler.hpp"

class CosineLR : public ILearningRateScheduler
{
public:
    CosineLR(uint64_t totalSteps, double baseLR, double minLR, LearningRateUpdateInterval updateInterval);
    double learningRateAt(uint64_t step) const override;
    LearningRateUpdateInterval getUpdateInterval() const override { return _updateInterval; }

private:
    const uint64_t _totalSteps;
    const double _minLR;
    const double _baseLR;
    const LearningRateUpdateInterval _updateInterval;
};
