#pragma once

#include <variant>

// 学習率を何ごとに更新するか。スケジューラーの種類とは独立した軸。
// ステップ数(learningRateAt に渡す t)を「バッチ数」で数えるか「エポック数」で数えるかを決める。
enum class LearningRateUpdateInterval
{
    PerBatch,
    PerEpoch,
};

struct NoneLearningRateSchedulerConfig
{
};

struct PolyLearningRateSchedulerConfig
{
    double initialLR = 0.0;
    double power = 0.9;
};

struct CosineLearningRateSchedulerConfig
{
    double initialLR = 0.0;
    double minLR = 0.0;
};

struct StepLearningRateSchedulerConfig
{
    double initialLR = 0.0;
    unsigned stepSize = 30; // 何エポックごとに下げるか(PerBatch のときは Factory がバッチ数に換算する)
    double gamma = 0.1;
};

using LearningRateSchedulerKind = std::variant<NoneLearningRateSchedulerConfig, PolyLearningRateSchedulerConfig, CosineLearningRateSchedulerConfig, StepLearningRateSchedulerConfig>;

struct LearningRateSchedulerConfig
{
    LearningRateSchedulerKind scheduler = NoneLearningRateSchedulerConfig{};
    LearningRateUpdateInterval updateInterval = LearningRateUpdateInterval::PerBatch;
    unsigned int warmupEpochs = 0; // エポック単位。PerBatch のときは Factory がバッチ数に換算する
};