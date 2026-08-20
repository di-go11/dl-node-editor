#pragma once

#include "src/training/adapters/interfaces/ILoss.hpp"

class CrossEntropy : public ILoss
{
public:
    CrossEntropy();
    void lossOut(const at::Tensor &predicted, const at::Tensor &target, at::Tensor &output) override;
};