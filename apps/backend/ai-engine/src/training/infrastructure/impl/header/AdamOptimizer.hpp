#pragma once
#include "training/adapters/interfaces/IOptimizer.hpp"

#include <memory>
#include <vector>

namespace torch
{
    class Tensor;
    namespace optim
    {
        class Adam;
    }
}

class AdamOptimizer : public IOptimizer
{

private:
    std::unique_ptr<torch::optim::Adam> _optim; // ポインタで持たせることにより、サイズが決まるため前方宣言の型を参照できるようになる。

public:
    AdamOptimizer(std::vector<torch::Tensor> &parameters, double learningRate);
    void resetGradients() override;
    void updateParmeters() override;
};