#pragma once

#include "training/adapters/interfaces/ILoss.hpp"
#include "training/infrastructure/torchFunc/DiceLoss.hpp"
#include "training/infrastructure/torchFunc/FocalLoss.hpp"

#include <cstdint>

// Combo Loss = alpha * CrossEntropy + (1-alpha) * DiceLoss。
//
// Cross Entropy 項は、既存の CrossEntropy(ILoss)クラスを流用しない。
// CrossEntropy::lossOut は生ロジットを前提に内部で softmax するが、
// Combo/Dice/Focal は「入力は既に softmax 済みの確率」という前提で統一しているため、
// 確率入力のまま computed できる FocalLoss(gamma=0, alpha=1)を Cross Entropy 項として
// 流用する(-log(pt) の平均は、gamma=0 の Focal Loss と数式的に同一)。
class ComboLoss : public ILoss
{
public:
    // alpha: Cross Entropy 項の重み。(1-alpha) が Dice 項の重み。
    ComboLoss(int numClasses, double alpha = 0.5, int64_t ignoreIndex = 255);
    void lossOut(const at::Tensor &predicted, const at::Tensor &target, at::Tensor &output) override;

private:
    double _alpha;
    DiceLoss _dice;
    FocalLoss _crossEntropy; // gamma=0 で運用
};
