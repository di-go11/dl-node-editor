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
        class SGD;
    }
}

class SGDOptimizer : public IOptimizer
{

private:
    std::unique_ptr<torch::optim::SGD> _optim;

public:
    SGDOptimizer(std::vector<at::Tensor> &parameters, double learningRate, double momentum = 0.9, double weight_decay = 1e-4, bool nesterov = false);

    // 宣言のみ。実体は .cpp 側(torch::optim::SGD が完全型になる場所)に置く。
    // ヘッダで暗黙生成させると ~unique_ptr<SGD> が sizeof(SGD) を要求し、
    // このクラスを生成・破棄する TU すべてに <torch/torch.h> が必要になってしまう。
    ~SGDOptimizer() override;

    OptimizerType type() const override { return OptimizerType::SGD; }

    void resetGradients() override;
    void updateParmeters() override;
    void updateLearningRate(double learningRate) override;
    double learningRate() const override;
    void writeTo(ICheckpointWriter &archive) const override;
    void readFrom(ICheckpointReader &archive) override;
};