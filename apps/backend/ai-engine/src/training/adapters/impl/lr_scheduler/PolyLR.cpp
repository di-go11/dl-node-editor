#include "PolyLR.hpp"

#include <algorithm>
#include <cmath>

PolyLR::PolyLR(uint64_t totalSteps, double initialLR, double power, LearningRateUpdateInterval updateInterval)
    : _initialLR(initialLR), _totalSteps(totalSteps), _power(power), _updateInterval(updateInterval)
{
}

double PolyLR::learningRateAt(uint64_t step) const
{
    const double remaining = std::max(0.0, 1.0 - static_cast<double>(step) / static_cast<double>(_totalSteps)); // 学習率が負になるのを防ぐ。
    return _initialLR * std::pow(remaining, _power);
}
