#pragma once

#include "training/entities/domain-objects/DataSpecs/DataSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/DAG/GraphValidation.hpp"
#include "training/entities/domain-objects/ModelGraph/ModelGraph.hpp"

#include <string>
#include <vector>

// 学習を始めずに、モデルのグラフがこのデータで学習できる形かを確かめる。
// gRPC の ValidateModelGraph(学習開始前の整合性チェック)から呼ぶ。torch・GPU は使わない。
// (docs/issues/2026-11-26/学習設定の検証をRustに集める.md の段階 2)
//
// 確認の順番:
//   1. 構造(validateGraphStructure): つなぎ方・ID・outputs・閉路
//      問題があればここで返す。閉路などがあると実行順が決まらず、形を計算できないため
//   2. 形
//      - segmentation: validateGraphShapes。各層の形に加えて、最終出力のチャンネル数 = クラス数、H / W = 入力
//      - それ以外: inferGraphShapes の問題だけ(クラス数との比較は、タスクごとの規則ができてから足す)
//
// 見つかった問題をすべて返す(問題がなければ空)。添字(nodeIndex など)は graph の中の位置。
// クラス数を求めるためにデータセットの色表(Original なら datasetPath/labelmap.txt)を読む。
// 読めなければ DatasetUnreadableError を投げる(設定の誤りではなく、データセットの問題のため)。
std::vector<GraphValidationError> checkModelGraph(const ModelGraph &graph,
                                                  const DataSpec &dataSpec,
                                                  const std::string &datasetPath);
