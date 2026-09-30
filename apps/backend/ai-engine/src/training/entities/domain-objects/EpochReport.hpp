#pragma once

#include "training/entities/domain-objects/Metrics/EpochMetrics.hpp"

#include <cstdint>

// 1エポック分の学習結果。TrainModelUsecase が ITrainingProgressObserver::onEpochCompleted で渡す。
struct EpochReport
{
    unsigned int epoch = 0;      // 完了したエポック番号
    double trainLoss = 0.0;      // 学習側は loss だけ(タスク別の指標は計算していない)
    EpochMetrics validation;     // 検証側の loss と TaskMetrics
    uint64_t epochElapsedMs = 0; // このエポックにかかった時間
    uint64_t totalElapsedMs = 0; // 学習開始からの累計時間
};
