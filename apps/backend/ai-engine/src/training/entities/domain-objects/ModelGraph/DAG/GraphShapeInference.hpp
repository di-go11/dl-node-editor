#pragma once

#include "training/entities/domain-objects/ModelGraph/DAG/GraphValidation.hpp"
#include "training/entities/domain-objects/ModelGraph/PortShape.hpp"

#include <cstdint>
#include <vector>

// 形状推論の結果。
struct GraphShapes
{
    // nodeOutputs[i] = graph.nodes[i] の出力ポートの形状(nodePortsOf の outputPorts と同じ順)。
    // 形状が合わず推論できなかったノードと、そこから先のノードは空のまま。
    std::vector<std::vector<PortShape>> nodeOutputs;

    // 見つかった問題(どのノードで合わないか)。空なら、すべてのノードの形状が決まっている。
    std::vector<GraphValidationError> errors;
};

// グラフ入力(画像。バッチ N を除いた C / H / W)から、各ノードの出力形状を実行順に求める。
// 層ごとの規則は NodeShapeRules.hpp にある。
// 入力に ValidatedModelGraph を取るので、構造・ポートの検証と実行順は済んでいることが型で保証される。
GraphShapes inferGraphShapes(const ValidatedModelGraph &graph, const FeatureMapShape &input);

// 形状の検証。inferGraphShapes の問題に加えて、セグメンテーションの出力として成り立つかを確認する。
//   - 最終出力が特徴マップである
//   - 最終出力のチャンネル数 = クラス数
//   - 最終出力の H / W = 入力の H / W(ピクセルごとの損失をターゲットと比べるため)
// 問題がなければ空の vector を返す。
std::vector<GraphValidationError> validateGraphShapes(const ValidatedModelGraph &graph,
                                                      const FeatureMapShape &input,
                                                      int64_t numClasses);
