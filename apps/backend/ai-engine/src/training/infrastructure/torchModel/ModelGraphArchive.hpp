#pragma once

#include <torch/serialize.h>

#include "training/entities/domain-objects/LayersParamsFields.hpp"
#include "training/entities/domain-objects/ModelGraph.hpp"

// ModelGraph(モデル構造の内部表現)を libtorch の archive に書き出す / 読み戻す。
//
// JSON 等の外部フォーマットは使わず、チェックポイント(.pt)と同じ torch archive に
// プリミティブ(int64 / double のスカラーテンソル)で直接書く。これにより
// 「重み + optimizer 状態 + 構造」を 1 ファイルに閉じ込められる。
//
// どのフィールドを書くかは entities の LayersParamsFields.hpp に一元化してあり
// (LayerKind もそちらで定義)、ここは「訪問された値を archive の型に載せ替える」
// だけを担当する。libtorch 依存はこの infrastructure 層に閉じる。

// このフォーマットのバージョン。*Params にフィールドを足す等で
// レイアウトが変わったら上げる。読み側は不一致を例外にする。
inline constexpr int64_t kModelGraphArchiveVersion = 1;

void writeModelGraph(torch::serialize::OutputArchive &archive, const ModelGraph &graph);

ModelGraph readModelGraph(torch::serialize::InputArchive &archive);
