#pragma once

#include "training/adapters/interfaces/ILoss.hpp"

class CrossEntropy : public ILoss
{
public:
    CrossEntropy();
    void lossOut(const at::Tensor &predicted, const at::Tensor &target, at::Tensor &output) override;
};