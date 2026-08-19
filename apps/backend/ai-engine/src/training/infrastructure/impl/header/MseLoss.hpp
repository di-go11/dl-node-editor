#include "src/training/adapters/interfaces/ILoss.hpp"

class MseLoss : public ILoss
{
public:
    MseLoss();
    void lossOut(const torch::Tensor &predicted, const torch::Tensor &target, torch::Tensor &output) override;
};