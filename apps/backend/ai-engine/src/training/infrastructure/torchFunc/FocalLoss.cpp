#include "training/infrastructure/torchFunc/FocalLoss.hpp"

#include <torch/torch.h>

FocalLoss::FocalLoss(const int numClasses, const double gamma, const double alpha, const int64_t ignoreIndex) : _numClasses(numClasses), _gamma(gamma), _alpha(alpha), _ignoreIndex(ignoreIndex) {}

void FocalLoss::lossOut(const at::Tensor &predicted, const at::Tensor &target, at::Tensor &output)
{
    at::Tensor validMask = (target != _ignoreIndex); // [N,H,W] bool

    at::Tensor safeTarget = target.clone();
    safeTarget.masked_fill_(~validMask, 0);

    namespace F = torch::nn::functional;

    at::Tensor oneHot = F::one_hot(safeTarget, _numClasses).permute({0, 3, 1, 2}).to(predicted.dtype());
    at::Tensor pt = (predicted * oneHot).sum(1); // [N,H,W] — クラス方向を潰して正解クラスの確率だけ残す

    pt = pt.clamp_min(1e-8);

    at::Tensor focalWeight = (1.0 - pt).pow(_gamma);
    at::Tensor perPixelLoss = -_alpha * focalWeight * torch::log(pt);

    at::Tensor maskedLoss = perPixelLoss * validMask.to(perPixelLoss.dtype());
    output = maskedLoss.sum() / validMask.sum().to(maskedLoss.dtype()).clamp_min(1.0);
}