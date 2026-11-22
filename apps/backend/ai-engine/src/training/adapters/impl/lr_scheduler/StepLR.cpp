#include "StepLR.hpp"

#include <algorithm>
#include <cmath>

StepLR::StepLR(uint64_t totalSteps, double initialLR, double gamma, LearningRateSchedulerType type)
    : _totalSteps(totalSteps), _initialLR(initialLR), _gamma(gamma), _type(type)
{
}

double StepLR::learningRateAt(uint64_t step) const
{
    const double remaining = std::max(0.0, 1.0 - static_cast<double>(step) / _totalSteps); // 学習率が負になるのを防ぐ。
    const double stepCount = step / _totalSteps;
    return _initialLR * std::pow(_gamma, stepCount);
}