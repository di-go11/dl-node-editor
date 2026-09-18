#pragma once

#include "training/adapters/interfaces/ILoss.hpp"

#include <cstdint>

class DiceLoss : public ILoss
{
public:
    DiceLoss(const int numClasses, const int64_t ignoreIndex = 255);
    void lossOut(const at::Tensor &predicted, const at::Tensor &target, at::Tensor &output) override;

private:
    int _numClasses;
    int64_t _ignoreIndex;
};