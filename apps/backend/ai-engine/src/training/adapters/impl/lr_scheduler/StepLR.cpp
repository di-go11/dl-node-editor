#include "StepLR.hpp"

#include <cmath>

StepLR::StepLR(uint64_t stepSize, double baseLR, double gamma, LearningRateUpdateInterval updateInterval)
    : _stepSize(stepSize), _baseLR(baseLR), _gamma(gamma), _updateInterval(updateInterval)
{
}

double StepLR::learningRateAt(uint64_t step) const
{
    // 何回目の区切りか。整数どうしの割り算は切り捨てなので、これがそのまま床関数になる。
    // double で割ってから floor すると、丸め誤差で区切りが 1 つずれることがある。
    const uint64_t k = step / _stepSize;
    return _baseLR * std::pow(_gamma, static_cast<double>(k));
}
