#pragma once

#include "../../../adapters/interfaces/IActivation.hpp"

class Sigmoid : public IActivation
{
public:
    Sigmoid();
    void activate(const at::Tensor &input, at::Tensor &output) override;
};