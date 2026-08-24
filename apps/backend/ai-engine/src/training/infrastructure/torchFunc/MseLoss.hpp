#pragma once

#include "training/adapters/interfaces/ILoss.hpp"

class MseLoss : public ILoss
{
public:
    MseLoss();
    void lossOut(const at::Tensor &predicted, const at::Tensor &target, at::Tensor &output) override;
};