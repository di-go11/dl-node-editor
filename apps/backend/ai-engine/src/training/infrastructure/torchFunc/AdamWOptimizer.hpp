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
        class AdamW;
    }
}

class AdamWOptimizer : public IOptimizer
{

private:
    std::unique_ptr<torch::optim::AdamW> _optim; // ポインタで持たせることにより、サイズが決まるため前方宣言の型を参照できるようになる。

public:
    AdamWOptimizer(std::vector<at::Tensor> &parameters, double learningRate, double beta1 = 0.9, double beta2 = 0.999, double weight_decay = 0.01);
    void resetGradients() override;
    void updateParmeters() override;
    void saveState(const std::string &filePath) override;
    void loadState(const std::string &filePath) override;
};