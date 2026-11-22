#pragma once
#include "training/adapters/interfaces/ILearningRateScheduler.hpp"
#include "training/adapters/impl/LearningRateSchedulerType.hpp"

class PolyLR : public ILearningRateScheduler
{
public:
    PolyLR(double totalSteps, double initialLR, double power, LearningRateSchedulerType type);

    double learningRateAt(uint64_t step) const override;
    LearningRateSchedulerType getType() const override { return _type; }

private:
    const double _initialLR;
    const double _totalSteps;
    const double _power;
    const LearningRateSchedulerType _type;
};