#pragma once

#include <torch/serialize.h>

#include "training/entities/domain-objects/CheckpointMeta.hpp"
#include "training/entities/domain-objects/ModelGraph/ModelGraph.hpp"

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
//   rng_state_cpu            : CPU 乱数生成器の状態(学習再開の再現性用)
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

// メタ情報(epoch / best_metric)だけを読む。モデル・optimizer は作らない。
// 学習を始める前に「再開できる checkpoint か」を確かめるのに使う。
CheckpointMeta readCheckpointMeta(torch::serialize::InputArchive &archive);

// モデルを構築する前に、checkpoint から ModelGraph だけを取り出す。
ModelGraph readModelGraphFromCheckpoint(torch::serialize::InputArchive &archive);

// checkpoint に記録された CPU 乱数生成器の状態を、プロセスのグローバル生成器へ復元する。
// 「保存時と同じ乱数列で学習を続ける」ための処理なので、学習再開
// (CheckpointModelLoader)からのみ呼ぶ。推論目的で重みだけ読む経路
// (TorchCheckpointStore::loadFrom)ではグローバル状態を触らない。
//
// 現状の学習ループには乱数を使う箇所(シャッフル / dropout / データ拡張)が無いため
// 実効的な差はまだ出ないが、それらが入ったときに再開が非再現になるのを防ぐため
// 先に配線しておく。GPU 生成器の状態は含まない(GPU 学習は未対応)。
//
// 戻り値: 復元できたら true。rng_state_cpu を持たない旧 checkpoint では
// 警告を出して false を返す(呼び出し側は続行してよい)。
bool restoreCpuRngStateIfPresent(torch::serialize::InputArchive &archive);
