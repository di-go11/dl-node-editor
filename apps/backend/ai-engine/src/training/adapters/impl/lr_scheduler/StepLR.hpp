#pragma once

#include "training/adapters/interfaces/ILearningRateScheduler.hpp"
#include "training/adapters/impl/LearningRateSchedulerType.hpp"

#include <cstdint>

class StepLR : public ILearningRateScheduler
{
public:
    StepLR(uint64_t totalSteps, double initialLR, double gamma, LearningRateSchedulerType type);
    double learningRateAt(uint64_t step) const override;
    LearningRateSchedulerType getType() const override { return _type; }

private:
    const uint64_t _totalSteps;
    const double _initialLR;
    const double _gamma;
    const LearningRateSchedulerType _type;
};