#pragma once

#include <torch/serialize.h>

#include "training/entities/domain-objects/CheckpointMeta.hpp"
#include "training/entities/domain-objects/ModelGraph.hpp"

class IModel;
class IOptimizer;

// checkpoint 1ファイル分のレイアウトを 1 か所に集約する。
//
//   model                    : モデル重み(IModel::writeTo / readFrom)
//   optimizer                : Optimizer 内部状態(IOptimizer::writeTo / readFrom)
//   optimizer_type           : string(Adam / AdamW / SGD。取り違え検出用)
//   epoch                    : int64
//   best_metric              : float64
//   model_graph_fingerprint  : string(構造の照合用ハッシュ)
//   model_graph              : ModelGraph 本体(構造の再構築用)
//
// これを TorchCheckpointStore(注入済み model/optimizer への in-place 復元)と
// CheckpointModelLoader(checkpoint からの再構築)の両方が使う。
// フォーマットを変えるときはこのファイルだけを直せばよい。

void writeCheckpointArchive(torch::serialize::OutputArchive &archive,
                            const IModel &model, const IOptimizer &optimizer,
                            const ModelGraph &graph, const CheckpointMeta &meta);

// model / optimizer / meta を復元する。
// 復元前に 2 つの照合を行い、どちらかが食い違えば std::runtime_error:
//   - expectedGraph の fingerprint と archive のそれ(モデル構造の取り違え)
//   - optimizer.type() と archive の optimizer_type(Optimizer の取り違え)
// 該当キーを持たない旧形式の checkpoint は、それぞれ警告のみでスキップする。
CheckpointMeta readCheckpointArchive(torch::serialize::InputArchive &archive,
                                     IModel &model, IOptimizer &optimizer,
                                     const ModelGraph &expectedGraph);

// モデルを構築する前に、checkpoint から ModelGraph だけを取り出す。
ModelGraph readModelGraphFromCheckpoint(torch::serialize::InputArchive &archive);
