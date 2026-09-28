#include "training/infrastructure/torchFunc/DiceLoss.hpp"

#include <torch/torch.h>

DiceLoss::DiceLoss(const int numClasses, const int64_t ignoreIndex) : _numClasses(numClasses), _ignoreIndex(ignoreIndex) {}

void DiceLoss::lossOut(const at::Tensor &predicted, const at::Tensor &target, at::Tensor &output)
{
    at::Tensor validMask = (target != _ignoreIndex); // [N,H,W] bool

    at::Tensor safeTarget = target.clone();
    safeTarget.masked_fill_(~validMask, 0);

    namespace F = torch::nn::functional;
    at::Tensor oneHot = F::one_hot(safeTarget, _numClasses).permute({0, 3, 1, 2}).to(predicted.dtype()); // [N,C,H,W]に並び替えてdtype()へ
    at::Tensor maskF = validMask.unsqueeze(1).to(predicted.dtype());                                     // [N,1,H,W](クラス方向へ伸ばす)
    at::Tensor maskedProbs = predicted * maskF;
    at::Tensor maskedOnehot = oneHot * maskF;

    constexpr double smooth = 1.0;

    at::Tensor intersection = (maskedProbs * maskedOnehot).sum({0, 2, 3});       // [C]
    at::Tensor denom = maskedProbs.sum({0, 2, 3}) + maskedOnehot.sum({0, 2, 3}); // [C]
    at::Tensor diceScore = (2.0 * intersection + smooth) / (denom + smooth);

    output = 1.0 - diceScore.mean();
}