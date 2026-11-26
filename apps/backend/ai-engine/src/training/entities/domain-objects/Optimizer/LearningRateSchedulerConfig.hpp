#pragma once

#include <variant>

// 学習率を何ごとに更新するか。スケジューラーの種類とは独立した軸。
// ステップ数(learningRateAt に渡す t)を「バッチ数」で数えるか「エポック数」で数えるかを決める。
enum class LearningRateUpdateInterval
{
    PerBatch,
    PerEpoch,
};

// 基準となる学習率(warmup 後のピーク)は各スケジューラーには持たせず、
// OptimizerConfig::learningRate を Factory に渡して使う(学習率の指定箇所を 1 か所にするため)。
// ここに置くのは「学習率をどう変化させるか」を決めるパラメータだけ。

struct NoneLearningRateSchedulerConfig
{
};

struct PolyLearningRateSchedulerConfig
{
    double power = 0.9;
};

struct CosineLearningRateSchedulerConfig
{
    double minLR = 0.0;
};

struct StepLearningRateSchedulerConfig
{
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