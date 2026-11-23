#include "CosineLR.hpp"
#include <cmath>
#include <algorithm>

// 引数の並びは .hpp と同じ (totalSteps, initialLR, minLR)。
// 型が同じ double どうしなので、並びが違ってもコンパイルは通ってしまう点に注意。
CosineLR::CosineLR(uint64_t totalSteps, double initialLR, double minLR, LearningRateUpdateInterval updateInterval)
    : _totalSteps(totalSteps), _minLR(minLR), _initialLR(initialLR), _updateInterval(updateInterval)
{
}

double CosineLR::learningRateAt(uint64_t step) const
{
    const double remaining = std::max(0.0, 1.0 - static_cast<double>(step) / static_cast<double>(_totalSteps)); // 学習率が負になるのを防ぐ。

    const double cosine = _minLR + (_initialLR - _minLR) * (1.0 + std::cos(M_PI * (1.0 - remaining))) / 2.0;
    return cosine;
}
