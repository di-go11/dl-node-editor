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

    // 宣言のみ。実体は .cpp 側(torch::optim::Adam が完全型になる場所)に置く。
    // ヘッダで暗黙生成させると ~unique_ptr<Adam> が sizeof(Adam) を要求し、
    // このクラスを生成・破棄する TU すべてに <torch/torch.h> が必要になってしまう。
    ~AdamOptimizer() override;

    OptimizerType type() const override { return OptimizerType::Adam; }

    void resetGradients() override;
    void updateParmeters() override;
    void updateLearningRate(double learningRate) override;
    double learningRate() const override;
    void writeTo(ICheckpointWriter &archive) const override;
    void readFrom(ICheckpointReader &archive) override;
};