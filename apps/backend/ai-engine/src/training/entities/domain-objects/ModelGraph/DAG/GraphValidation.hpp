#pragma once

#include "training/entities/domain-objects/ModelGraph/ModelGraph.hpp"

#include <optional>
#include <string>
#include <vector>
#include <cstddef>

struct GraphValidationError
{
    std::string nodeId;
    std::string port;
    std::string message;
    // 問題のある場所を、グラフの中の添字で示す(該当しないものは nullopt)。
    // 呼び出し側が、リクエストの中の位置(nodes[3].inputs[1] など)を組み立てるのに使う。
    std::optional<std::size_t> nodeIndex;   // graph.nodes の添字
    std::optional<std::size_t> inputIndex;  // そのノードの inputs の添字
    std::optional<std::size_t> outputIndex; // graph.outputs の添字
};

// グラフの構造を検証し、見つかった問題をすべて返す(問題がなければ空)。例外は投げない。
// 確認すること: ノードが空でない、ID(空・重複・文字種)、参照先の存在、outputs、ポートのつなぎ方、閉路。
// 閉路は、ほかの問題がないときだけ調べる(実行順の計算が、ID が一意で参照先が存在することを前提にするため)。
std::vector<GraphValidationError> validateGraphStructure(const ModelGraph &graph);

class ValidatedModelGraph
{
public:
    static ValidatedModelGraph create(const ModelGraph &graph); // 検証済みモデルのオブジェクトを返すことを保証する。 staticにすることでオブジェクトを作らなくても使用できるためstaticを使う。

    const ModelGraph &getGraph() const { return _graph; };
    // 検証のときに求めた実行順(graph.nodes の添字)。
    const std::vector<std::size_t> &getOrder() const { return _order; }

private:
    ValidatedModelGraph(ModelGraph, std::vector<std::size_t> order);

    ModelGraph _graph;
    std::vector<std::size_t> _order;
};