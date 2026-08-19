#include "src/training/adapters/interfaces/ILoss.hpp"

class CrossEntropy : public ILoss
{
    CrossEntropy();
    void lossOut(const torch::Tensor &predicted, const torch::Tensor &target, torch::Tensor &output) override;
};
