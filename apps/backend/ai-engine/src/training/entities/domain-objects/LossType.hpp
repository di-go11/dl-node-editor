#pragma once

enum class LossType
{
    CrossEntropy,
    MseLoss,
    DiceLoss,  // inputとして、活性化関数softmaxで活性化されたものみ受け付ける。
    FocalLoss, // 上に同じ
    ComboLoss,
    BoundaryLoss
};