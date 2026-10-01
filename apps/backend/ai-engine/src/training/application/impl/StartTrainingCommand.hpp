#pragma once

#include "training/entities/domain-objects/ModelGraph/ModelGraph.hpp"
#include "training/entities/domain-objects/OptimizerConfig.hpp"
#include "training/entities/domain-objects/LossConfig.hpp"
#include "training/entities/domain-objects/ComputeDevice.hpp"
#include "training/entities/domain-objects/DataSpecs/DataSpec.hpp"

#include <cstdint>
#include <optional>
#include <string>

struct StartTrainingCommand
{
    std::string modelName;
    ModelGraph modelGraph;
    OptimizerConfig optimizer;
    LossConfig loss;
    unsigned int epochSize = 1;
    // saveLastEvery: 「直近」チェックポイントを何エポックごとに書くか(0 = 毎エポック)。
    unsigned int saveLastEvery = 0;
    unsigned int batchSize = 1;
    std::string datasetPath;
    std::string resumeFrom;
    // device: 演算するデバイスを指定。
    ComputeDevice device;
    // 学習パラメータではなく、データ形式ごとで異なる仕様の定義
    // ImageSpec: 画像サイズ、画像タスクごとの仕様、アノテーションのconfigを持つ。
    DataSpec dataSpec;
    // seed: 乱数シード。0 も有効な値なので optional で「未指定」と区別する(未指定 = 固定しない)。
    std::optional<std::uint64_t> seed;
};