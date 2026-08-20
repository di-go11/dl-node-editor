#pragma once

#include "training/adapters/interfaces/IActivation.hpp"

class ReLU : public IActivation
{
public:
    ReLU();
    void activate(const at::Tensor &input, at::Tensor &output) override;
};