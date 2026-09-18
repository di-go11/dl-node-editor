#pragma once

#include "training/adapters/interfaces/ILoss.hpp"

class CrossEntropy : public ILoss
{
public:
    void lossOut(const at::Tensor &predicted, const at::Tensor &target, at::Tensor &output) override;
};