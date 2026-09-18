#pragma once

enum class LossType
{
    ClossEntropy,
    MSE_loss,
    Dice_loss,  // inputとして、活性化関数softmaxで活性化されたものみ受け付ける。
    Focal_loss, // 上に同じ
    Combo_loss,
    Boundary_loss
};