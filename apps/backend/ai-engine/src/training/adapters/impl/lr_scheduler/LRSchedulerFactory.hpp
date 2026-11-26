#pragma once

#include "training/adapters/interfaces/ILearningRateScheduler.hpp"
#include "training/entities/domain-objects/Optimizer/LearningRateSchedulerConfig.hpp"

#include <cstdint>
#include <memory>

// config(エポック単位の値)から学習率スケジューラーを組み立てる。
// エポック単位の値をステップ単位に換算するのはここだけで行い、各スケジューラーは単位を知らない。
//   PerBatch: 1 ステップ = 1 バッチ(総ステップ数 = totalEpochs × batchesPerEpoch)
//   PerEpoch: 1 ステップ = 1 エポック(総ステップ数 = totalEpochs)
// None のときは nullptr を返す(学習率は Optimizer の設定値のまま変えない)。
// baseLR は基準となる学習率(warmup 後のピーク)。OptimizerConfig::learningRate を渡す。
// OptimizerConfig 全体ではなく値だけを受け取り、スケジューラーが Optimizer の設定型に依存しないようにしている。
// 設定が不正なとき(None + warmup、warmup が総エポック数以上、stepSize が 0 など)は std::invalid_argument を投げる。
std::shared_ptr<ILearningRateScheduler> createLRScheduler(const LearningRateSchedulerConfig &config,
                                                          double baseLR,
                                                          unsigned int totalEpochs,
                                                          uint64_t batchesPerEpoch);
