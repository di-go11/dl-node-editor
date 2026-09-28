#pragma once

#include "training/entities/domain-objects/LossType.hpp"

#include <cstdint>
#include <stdexcept>
#include <type_traits>
#include <variant>

// Loss ごとの設定。OptimizerConfig と同じ std::variant 方式(種別ごとに
// 必要なフィールドだけを持つ独立した構造体)に揃えてある。
//
// infrastructure/torchFunc/ にある同名の ILoss 実装クラス(CrossEntropy,
// MseLoss, DiceLoss, FocalLoss, ComboLoss, BoundaryLoss)とグローバル名前空間
// で衝突しないよう、設定側は *Config サフィックスを付けている
// (AdamOptimizer / AdamOptimizerConfig と同じ命名規則)。
//
// 既定値は各 Loss 実装のコンストラクタ既定値と一致させてある。

struct CrossEntropyConfig
{
};

struct MseLossConfig
{
};

// クラス数(numClasses)と ignoreIndex は Config ではなく ILossFactory::create の引数で受け取る
// (データセット由来の値で、モデル出力チャネル数・評価器と同じ値を使う必要があるため)。
// Dice_loss / Focal_loss / Combo_loss / Boundary_loss はこれらを使う
// (LossType.hpp のコメントの通り、softmax 活性化済みの確率を入力とする)。

struct DiceLossConfig
{
};

struct FocalLossConfig
{
    double gamma;
    double alpha;
};

struct ComboLossConfig
{
    double alpha = 0.5;
};

struct BoundaryLossConfig
{
};

// variant の並び順は LossType と対応させておく。
using LossConfig = std::variant<
    CrossEntropyConfig,
    MseLossConfig,
    DiceLossConfig,
    FocalLossConfig,
    ComboLossConfig,
    BoundaryLossConfig>;

inline LossType LossTypeOf(const LossConfig &config)
{
    return std::visit(
        [](const auto &c) -> LossType
        {
            using T = std::decay_t<decltype(c)>;
            if constexpr (std::is_same_v<T, CrossEntropyConfig>)
            {
                return LossType::CrossEntropy;
            }
            else if constexpr (std::is_same_v<T, MseLossConfig>)
            {
                return LossType::MseLoss;
            }
            else if constexpr (std::is_same_v<T, DiceLossConfig>)
            {
                return LossType::DiceLoss;
            }
            else if constexpr (std::is_same_v<T, FocalLossConfig>)
            {
                return LossType::FocalLoss;
            }
            else if constexpr (std::is_same_v<T, ComboLossConfig>)
            {
                return LossType::ComboLoss;
            }
            else if constexpr (std::is_same_v<T, BoundaryLossConfig>)
            {
                return LossType::BoundaryLoss;
            }
            else
            {
                throw std::runtime_error("未対応のLossConfig型です");
            }
        },
        config);
}