#pragma once

#include "training/adapters/interfaces/ILoss.hpp"

#include <cstdint>

class FocalLoss : public ILoss
{
public:
    FocalLoss(const int numClasses, const double gamma, const double alpha, const int64_t ignoreIndex = 255);
    void lossOut(const at::Tensor &predicted, const at::Tensor &target, at::Tensor &output) override;

private:
    int _numClasses;
    double _gamma;
    double _alpha;
    int64_t _ignoreIndex;
};