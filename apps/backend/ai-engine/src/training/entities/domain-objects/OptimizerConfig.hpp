#pragma once

#include "training/entities/domain-objects/OptimizerType.hpp"

#include <variant>

// Optimizer ごとの設定。
//
// 以前は OptimizerConfig を基底に継承していたが、AppConfig が基底の「値」で
// 保持していたためスライシングが起き、beta1 / momentum といった派生固有の
// フィールドが Factory まで届かなかった。
// NodeSpec(モデル層のパラメータ)と同じ std::variant 方式に揃え、
// 「種別ごとに必要なフィールドだけを持つ独立した構造体」として扱う。
//
// 学習率は全 Optimizer に共通の属性なので、種別ごとの構造体には持たせず
// OptimizerConfig の共通フィールドに置く(LearningRateSchedulerConfig と同じ
// 「共通フィールド + 種別ごとの variant」構成)。
// 学習率スケジューラーもこの値を基準(warmup 後のピーク)として使うため、
// 学習率の指定箇所はここ 1 か所だけになる。
//
// 既定値は各 Optimizer 実装のコンストラクタ既定値と一致させてある。

struct AdamOptimizerConfig
{
    double weightDecay = 0.0;
    double beta1 = 0.9;
    double beta2 = 0.999;
    double eps = 1e-8;
};

struct AdamWOptimizerConfig
{
    double weightDecay = 0.01;
    double beta1 = 0.9;
    double beta2 = 0.999;
};

struct SGDOptimizerConfig
{
    double weightDecay = 1e-4;
    double momentum = 0.9;
    bool nesterov = false;
};

// variant の並び順は OptimizerType と対応させておく(optimizerTypeOf 参照)。
using OptimizerKind = std::variant<AdamOptimizerConfig, AdamWOptimizerConfig, SGDOptimizerConfig>;

struct OptimizerConfig
{
    double learningRate = 0.001; // 基準学習率。スケジューラー使用時はここから変化させる
    OptimizerKind kind = AdamOptimizerConfig{};
};

// どの Optimizer の設定かを返す。
// checkpoint への種別記録や、種別だけを見たい箇所で使う。
inline OptimizerType optimizerTypeOf(const OptimizerConfig &config)
{
    return std::visit(
        [](const auto &c) -> OptimizerType
        {
            using T = std::decay_t<decltype(c)>;
            if constexpr (std::is_same_v<T, AdamOptimizerConfig>)
            {
                return OptimizerType::Adam;
            }
            else if constexpr (std::is_same_v<T, AdamWOptimizerConfig>)
            {
                return OptimizerType::AdamW;
            }
            else
            {
                static_assert(std::is_same_v<T, SGDOptimizerConfig>,
                              "未対応の OptimizerConfig 型です");
                return OptimizerType::SGD;
            }
        },
        config.kind);
}
