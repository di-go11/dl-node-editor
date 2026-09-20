#pragma once

#include "training/entities/domain-objects/LossConfig.hpp"

#include <cstdint>
#include <memory>

class ILoss;

// LossConfig から ILoss を組み立てるポート。
//
// ignoreIndex は Loss の設定ではなく、マスク画像の規約(Letterbox 余白などを
// 表す予約ラベル値)。前処理・評価と同じ値を使う必要があるため、Config とは別に
// 受け取る。クラスの概念を持たない Loss(MseLoss)は無視してよい。
class ILossFactory
{
public:
    virtual ~ILossFactory() = default;

    virtual std::shared_ptr<ILoss> create(const LossConfig &config, int64_t ignoreIndex) = 0;
};
