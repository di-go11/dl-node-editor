#pragma once

#include "training/adapters/interfaces/ILearningRateScheduler.hpp"
#include

#include <memory>

class WarmupLR : public ILearningRateScheduler
{
public:
    WarmupLR(std::shared_ptr<ILearningRateScheduler> baseScheduler, unsigned int warmupEpochs);

    double learningRateAt(uint64_t step) const override;
    LearningRateSchedulerType getType() const override { return _baseScheduler->getType(); }

private:
    const std::shared_ptr<IlearningRateScheduler> _baseScheduler;
    const unsigned int _warmupEpochs;
};