#pragma once
#include "training/adapters/interfaces/IOptimizer.hpp"

#include <memory>
#include <vector>

namespace at
{
    class Tensor;
}

namespace torch
{
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
    AdamOptimizer(std::vector<at::Tensor> &parameters, double learningRate, double beta1 = 0.9, double beta2 = 0.999, double eps = 1e-8, double weight_decay = 0.0);
    void resetGradients() override;
    void updateParmeters() override;
    void writeTo(ICheckpointWriter &archive) const override;
    void readFrom(ICheckpointReader &archive) override;
};