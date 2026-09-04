#pragma once

#include <torch/serialize.h>

#include "training/entities/domain-objects/ModelGraph.hpp"

// ModelGraph(モデル構造の内部表現)を libtorch の archive に書き出す / 読み戻す。
//
// JSON 等の外部フォーマットは使わず、チェックポイント(.pt)と同じ torch archive に
// プリミティブ(int64 / double のスカラーテンソル)で直接書く。これにより
// 「重み + optimizer 状態 + 構造」を 1 ファイルに閉じ込められる。
//
// libtorch 依存はこの infrastructure 層に閉じる。adapters / application 層は
// ModelGraph(entities)だけを扱う。

// archive 内の層種タグ。値は永続化されるため決して変更しない(追加は末尾に)。
// LayersParams(std::variant)の alternative と 1:1 で対応する。
enum class LayerKind : int64_t
{
    Conv2D = 0,
    Pooling = 1,
    BatchNorm = 2,
    Linear = 3,
    Activation = 4,
};

// このフォーマットのバージョン。*Params にフィールドを足す等で
// レイアウトが変わったら上げる。読み側は不一致を例外にする。
inline constexpr int64_t kModelGraphArchiveVersion = 1;

void writeModelGraph(torch::serialize::OutputArchive &archive, const ModelGraph &graph);

ModelGraph readModelGraph(torch::serialize::InputArchive &archive);
