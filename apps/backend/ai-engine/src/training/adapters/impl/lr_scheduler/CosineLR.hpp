#pragma once

#include "training/adapters/interfaces/ILearningRateScheduler.hpp"
#include "training/adapters/impl/LearningRateSchedulerType.hpp"

class CosineLR : public ILearningRateScheduler
{
public:
    CosineLR(double totalSteps, double initialLR, double minLR, LearningRateSchedulerType type);
    double learningRateAt(uint64_t step) const override;
    LearningRateSchedulerType getType() const override { return _type; };

private:
    const double _totalSteps;
    const double _minLR;
    const double _initialLR;
    const LearningRateSchedulerType _type;
};