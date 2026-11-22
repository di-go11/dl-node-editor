#include "PolyLR.hpp"

#include <algorithm>
#include <cmath>

PolyLR::PolyLR(double totalSteps, double initialLR, double power, LearningRateSchedulerType type)
    : _initialLR(initialLR), _totalSteps(totalSteps), _power(power), _type(type)
{
}

double PolyLR::learningRateAt(uint64_t step) const
{
    const double remaining = std::max(0.0, 1.0 - static_cast<double>(step) / _totalSteps); // 学習率が負になるのを防ぐ。
    return _initialLR * std::pow(remaining, _power);
}