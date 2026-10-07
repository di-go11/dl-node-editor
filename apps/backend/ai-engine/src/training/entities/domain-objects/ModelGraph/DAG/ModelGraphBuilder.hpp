#pragma once

#include "training/entities/domain-objects/ModelGraph/ModelGraph.hpp"

#include <string>
#include <utility>
#include <vector>

// ModelGraph を、層を足していく形で組み立てる。
//
// 検証はしない。build() が返すのは検証前の ModelGraph で、
// ValidatedModelGraph::create が検証と実行順の計算を行う(検証の責務はそこに集める)。
//
// 使い方(直列の場合):
//   ModelGraphBuilder builder;
//   builder.add(NodeSpec{conv});   // 最初のノードは、グラフ入力を x につなぐ
//   builder.add(NodeSpec{relu});   // 直前のノードの y を x につなぐ
//   ModelGraph graph = builder.build(); // 最後に足したノードの y が、モデルの出力になる
//
// 分岐・合流(SegNet の indices など)は、add の第 2 引数で入力を明示する。
class ModelGraphBuilder
{
public:
    // 直前のノードの出力 y を、入力 x につないで足す。足したノードの ID を返す。
    std::string add(const NodeSpec &layer)
    {
        return add(layer, {NodeInput{"x", previousOutput()}});
    }

    // 入力を明示して足す。足したノードの ID を返す。
    std::string add(const NodeSpec &layer, std::vector<NodeInput> inputs)
    {
        GraphNode node;
        node.id = "n" + std::to_string(_graph.nodes.size());
        node.spec = layer;
        node.inputs = std::move(inputs);
        _graph.nodes.push_back(std::move(node));
        return _graph.nodes.back().id;
    }

    // 最後に足したノードの出力 y。add の入力を明示するときに使う。
    PortRef lastOutput() const { return previousOutput(); }

    // 最後に足したノードの y を outputs にして、ModelGraph を返す。
    ModelGraph build() const
    {
        ModelGraph graph = _graph;
        if (!graph.nodes.empty())
        {
            graph.outputs = {PortRef{graph.nodes.back().id, "y"}};
        }
        return graph;
    }

private:
    // 直前のノードの出力 y。まだノードがなければ、グラフ入力(ノード ID もポート名も空)。
    PortRef previousOutput() const
    {
        if (_graph.nodes.empty())
        {
            return PortRef{"", ""};
        }
        return PortRef{_graph.nodes.back().id, "y"};
    }

    ModelGraph _graph;
};
