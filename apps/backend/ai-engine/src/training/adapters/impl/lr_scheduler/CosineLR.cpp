#include "CosineLR.hpp"
#include <cmath>
#include <algorithm>

CosineLR::CosineLR(double totalSteps, double minLR, double initialLR, LearningRateSchedulerType type)
    : _totalSteps(totalSteps), _minLR(minLR), _initialLR(initialLR), _type(type)
{
}

double CosineLR::learningRateAt(uint64_t step) const
{
    const double remaining = std::max(0.0, 1.0 - static_cast<double>(step) / _totalSteps); // 学習率が負になるのを防ぐ。

    const double cosine = _minLR + (_initialLR - _minLR) * (1.0 + std::cos(M_PI * (1.0 - remaining))) / 2.0;
    return cosine;
}