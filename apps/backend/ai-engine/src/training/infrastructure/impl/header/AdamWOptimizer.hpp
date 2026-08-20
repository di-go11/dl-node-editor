#include "training/adapters/interfaces/IOptimizer.hpp"

#include <memory>
#include <vector>

namespace torch
{
    class Tensor;
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
    AdamWOptimizer(std::vector<torch::Tensor> &parameters, double learningRate);
    void resetGradients() override;
    void updateParmeters() override;
};