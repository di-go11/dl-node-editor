#pragma once

#include "training/adapters/interfaces/ILearningRateScheduler.hpp"

#include <memory>

// Decorator: 中のスケジューラーの前に、学習率を線形に上げる期間を足す。
// 本来のスケジュールは warmupSteps だけ後ろにずらす(中のスケジューラーには step - warmupSteps を渡す)。
class WarmupLR : public ILearningRateScheduler
{
public:
    WarmupLR(std::shared_ptr<ILearningRateScheduler> baseScheduler, uint64_t warmupSteps);

    double learningRateAt(uint64_t step) const override;
    LearningRateUpdateInterval getUpdateInterval() const override { return _baseScheduler->getUpdateInterval(); }

private:
    const std::shared_ptr<ILearningRateScheduler> _baseScheduler;
    const uint64_t _warmupSteps;
};
