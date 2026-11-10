#pragma once

#include "training/entities/domain-objects/ModelGraph/DAG/GraphValidation.hpp"
#include "training/entities/domain-objects/OptimizerConfig.hpp"
#include "training/entities/domain-objects/LossConfig.hpp"
#include "training/entities/domain-objects/ComputeDevice.hpp"
#include "training/entities/domain-objects/DataSpecs/DataSpec.hpp"

#include <cstdint>
#include <optional>
#include <string>

struct StartTrainingCommand
{
    // modelId: モデルの ID(Rust 側が発行)。checkpoint のファイル名(<modelId>_best.pt / _last.pt)に使う。
    // 空は不可(空だと全学習が同じファイルを共有し、別モデルの重みから再開してしまうため)。
    std::string modelId;
    // resume: true なら <modelId>_last.pt から再開する。false ならファイルがあっても読まずに最初から学習する。
    bool resume = false;
    // modelGraph: 検証済みのモデル構造。ValidatedModelGraph は create からしか作れないので、
    // 値が入っていれば必ず検証を通っている。呼び出し側(mapper / CLI)が埋める。nullopt = 未設定。
    std::optional<ValidatedModelGraph> modelGraph;
    OptimizerConfig optimizer;
    LossConfig loss;
    unsigned int epochSize = 1;
    // saveLastEvery: 「直近」チェックポイントを何エポックごとに書くか(0 = 毎エポック)。
    unsigned int saveLastEvery = 0;
    unsigned int batchSize = 1;
    std::string datasetPath;
    // device: 演算するデバイスを指定。
    ComputeDevice device;
    // 学習パラメータではなく、データ形式ごとで異なる仕様の定義
    // ImageSpec: 画像サイズ、画像タスクごとの仕様、アノテーションのconfigを持つ。
    DataSpec dataSpec;
    // seed: 乱数シード。0 も有効な値なので optional で「未指定」と区別する(未指定 = 固定しない)。
    std::optional<std::uint64_t> seed;
};