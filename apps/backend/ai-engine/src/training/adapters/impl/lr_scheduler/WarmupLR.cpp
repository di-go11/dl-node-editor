#include "WarmupLR.hpp"

WarmupLR::WarmupLR(std::shared_ptr<ILearningRateScheduler> baseScheduler, uint64_t warmupSteps)
    : _baseScheduler(baseScheduler), _warmupSteps(warmupSteps)
{
}

double WarmupLR::learningRateAt(uint64_t step) const
{
    if (step < _warmupSteps)
    {
        // Warmup期間中は線形に学習率を増加させる(目標は中のスケジューラーの最初の値)
        return _baseScheduler->learningRateAt(0) * (static_cast<double>(step + 1) / static_cast<double>(_warmupSteps));
    }
    else
    {
        // Warmup期間後はベースのスケジューラの学習率を使用する
        return _baseScheduler->learningRateAt(step - _warmupSteps);
    }
}
