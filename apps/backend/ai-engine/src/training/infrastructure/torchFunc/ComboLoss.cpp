#include "training/infrastructure/torchFunc/ComboLoss.hpp"

#include <torch/torch.h>

ComboLoss::ComboLoss(const int numClasses, const double alpha, const int64_t ignoreIndex)
    : _alpha(alpha),
      _dice(numClasses, ignoreIndex),
      _crossEntropy(numClasses, /*gamma=*/0.0, /*alpha=*/1.0, ignoreIndex)
{
}

void ComboLoss::lossOut(const at::Tensor &predicted, const at::Tensor &target, at::Tensor &output)
{
    at::Tensor diceOut;
    _dice.lossOut(predicted, target, diceOut);

    at::Tensor ceOut;
    _crossEntropy.lossOut(predicted, target, ceOut);

    output = _alpha * ceOut + (1.0 - _alpha) * diceOut;
}
