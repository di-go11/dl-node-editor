#pragma once

#include "training/adapters/interfaces/IActivation.hpp"

class Softmax : public IActivation
{

private:
    int _dim = 1;

public:
    Softmax(int dim);
    void activate(const at::Tensor &input, at::Tensor &output) override;
};