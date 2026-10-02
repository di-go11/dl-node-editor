#include "GraphValidation.hpp"

#include "NodeChecker.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/LayersPort.hpp"

#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace
{
    // ノードの ID から、graph.nodes の中での添字を引く表を作る。
    // ID が重複していると後のノードで上書きされるため、collectStructureErrors を通った後に使うこと。
    std::unordered_map<std::string, std::size_t> buildIndexOf(const ModelGraph &graph)
    {
        std::unordered_map<std::string, std::size_t> indexOf;
        for (std::size_t i = 0; i < graph.nodes.size(); ++i)
        {
            indexOf[graph.nodes[i].id] = i;
        }
        return indexOf;
    }

    constexpr std::size_t kNoPort = static_cast<std::size_t>(-1);

    // ポート名から、その層の仕様(layerPortsOf)の中での添字を引く。無ければ kNoPort。
    template <typename PortSpecs>
    std::size_t findPort(const PortSpecs &ports, const std::string &name)
    {
        for (std::size_t i = 0; i < ports.size(); ++i)
        {
            if (ports[i].name == name)
            {
                return i;
            }
        }
        return kNoPort;
    }

    // 出力の種類と入力の種類をつないでよいか。Any は、どちらの種類ともつなげる。
    bool kindsCompatible(PortKind output, PortKind input)
    {
        return output == PortKind::Any || input == PortKind::Any || output == input;
    }

    const char *kindName(PortKind kind)
    {
        switch (kind)
        {
        case PortKind::Feature:
            return "Feature(特徴マップ)";
        case PortKind::Indices:
            return "Indices";
        case PortKind::Tokens:
            return "Tokens(トークン列)";
        case PortKind::Any:
            return "Any";
        }
        return "不明";
    }

    // ポートの検証。layerPortsOf と突き合わせて、つなぎ方が層の仕様に合っているか確認する。
    //   - 入力ポート名が、その層にある
    //   - 参照先の出力ポート名が、参照先の層にある
    //   - 出力の種類と入力の種類が合う(PortKind)
    //   - つなぐ本数が合う(必須のポートの未接続、可変長でないポートへの 2 本以上の接続)
    //   - outputs のポート名が、そのノードの出力ポートにある
    // グラフ入力(参照先のノード ID が空)は、特徴マップとして扱う。ポート名は空でなければならない。
    void validateGraphPorts(const ModelGraph &graph,
                            const std::unordered_map<std::string, std::size_t> &indexOf,
                            std::vector<GraphValidationError> &errors)
    {
        for (std::size_t i = 0; i < graph.nodes.size(); ++i)
        {
            const GraphNode &node = graph.nodes[i];
            const LayerPortSpec spec = layerPortsOf(node.layer);
            std::vector<std::size_t> connectionCount(spec.inputPorts.size(), 0);

            for (std::size_t j = 0; j < node.inputs.size(); ++j)
            {
                const NodeInput &input = node.inputs[j];
                const std::size_t portIndex = findPort(spec.inputPorts, input.port);
                if (portIndex == kNoPort)
                {
                    errors.push_back({node.id, input.port, "この層に入力ポート '" + input.port + "' はありません", i, j});
                    continue;
                }
                ++connectionCount[portIndex];

                PortKind sourceKind = PortKind::Feature; // グラフ入力
                const std::string &sourceId = input.source.nodeId;
                if (!sourceId.empty())
                {
                    const auto source = indexOf.find(sourceId);
                    if (source == indexOf.end())
                    {
                        continue; // 参照先が存在しない問題は、上で報告済み
                    }
                    const LayerPortSpec sourceSpec = layerPortsOf(graph.nodes[source->second].layer);
                    const std::size_t outputIndex = findPort(sourceSpec.outputPorts, input.source.port);
                    if (outputIndex == kNoPort)
                    {
                        errors.push_back({node.id, input.port,
                                          "参照先のノード '" + sourceId + "' に出力ポート '" + input.source.port + "' はありません",
                                          i, j});
                        continue;
                    }
                    sourceKind = sourceSpec.outputPorts[outputIndex].kind;
                }
                else if (!input.source.port.empty())
                {
                    // グラフ入力は 1 つだけなので、ポート名では区別しない(ノード ID もポート名も空で表す)
                    errors.push_back({node.id, input.port,
                                      "グラフ入力を指すとき(参照先のノード ID が空)は、参照先のポート名も空にしてください(現在 '" +
                                          input.source.port + "')",
                                      i, j});
                }

                const PortKind inputKind = spec.inputPorts[portIndex].kind;
                if (!kindsCompatible(sourceKind, inputKind))
                {
                    errors.push_back({node.id, input.port,
                                      std::string("つなげない種類です(出力: ") + kindName(sourceKind) +
                                          "、入力: " + kindName(inputKind) + ")",
                                      i, j});
                }
            }

            for (std::size_t k = 0; k < spec.inputPorts.size(); ++k)
            {
                const InputPortSpec &port = spec.inputPorts[k];
                const std::size_t count = connectionCount[k];
                if (port.variadic)
                {
                    if (count < port.minCount)
                    {
                        errors.push_back({node.id, port.name,
                                          "つなぐ本数が足りません(最低 " + std::to_string(port.minCount) +
                                              " 本、現在 " + std::to_string(count) + " 本)",
                                          i});
                    }
                }
                else if (count == 0)
                {
                    errors.push_back({node.id, port.name, "必須の入力ポートがつながっていません", i});
                }
                else if (count > 1)
                {
                    errors.push_back({node.id, port.name,
                                      "このポートには 1 本しかつなげません(現在 " + std::to_string(count) + " 本)", i});
                }
            }
        }

        for (std::size_t o = 0; o < graph.outputs.size(); ++o)
        {
            const PortRef &output = graph.outputs[o];
            const auto source = indexOf.find(output.nodeId);
            if (source == indexOf.end())
            {
                continue; // 参照先が存在しない問題は、上で報告済み
            }
            const LayerPortSpec sourceSpec = layerPortsOf(graph.nodes[source->second].layer);
            if (findPort(sourceSpec.outputPorts, output.port) == kNoPort)
            {
                errors.push_back({output.nodeId, output.port,
                                  "outputs が指す出力ポート '" + output.port + "' が、ノード '" + output.nodeId + "' にありません",
                                  std::nullopt, std::nullopt, o});
            }
        }
    }

    // 閉路以外の規則。問題なければ空の vector を返す。
    //
    // ここで確認するのは、topologicalSort が前提にしていること(ID が一意、参照先が存在する)と、
    // outputs の指定、ポートのつなぎ方(validateGraphPorts)。
    std::vector<GraphValidationError> collectStructureErrors(const ModelGraph &graph)
    {
        std::vector<GraphValidationError> errors;

        if (graph.nodes.empty())
        {
            errors.push_back({"", "", "ノードが 1 つもありません"});
        }

        // ID が空でないこと、重複していないこと
        std::unordered_map<std::string, std::size_t> indexOf;
        for (std::size_t i = 0; i < graph.nodes.size(); ++i)
        {
            const std::string &id = graph.nodes[i].id;
            if (id.empty())
            {
                // 空の ID は「グラフ入力」を指す値として使うため、ノードには付けられない
                errors.push_back({"", "", "ノード ID が空です", i});
                continue;
            }

            const bool inserted = indexOf.emplace(id, i).second;
            if (!inserted)
            {
                errors.push_back({id, "", "ノード ID が重複しています", i});
            }
            else if (!isValidGraphNodeId(id))
            {
                errors.push_back({id, "", "ノード ID に使えない文字が含まれています(英数字・'-'・'_' のみ)", i});
            }
        }

        // 各入力の参照先のノードが存在すること(空 = グラフ入力 は対象外)
        for (std::size_t i = 0; i < graph.nodes.size(); ++i)
        {
            const GraphNode &node = graph.nodes[i];
            for (std::size_t j = 0; j < node.inputs.size(); ++j)
            {
                const NodeInput &input = node.inputs[j];
                const std::string &sourceId = input.source.nodeId;
                if (!sourceId.empty() && indexOf.count(sourceId) == 0)
                {
                    errors.push_back({node.id, input.port, "参照先のノードが存在しません: " + sourceId, i, j});
                }
            }
        }

        // モデルの出力。当面は 1 つだけ受け付ける
        if (graph.outputs.size() != 1)
        {
            errors.push_back({"", "", "outputs は 1 つだけ指定してください(現在 " + std::to_string(graph.outputs.size()) + " 個)"});
        }
        for (std::size_t o = 0; o < graph.outputs.size(); ++o)
        {
            const PortRef &output = graph.outputs[o];
            if (output.nodeId.empty())
            {
                errors.push_back({"", output.port, "outputs にグラフ入力は指定できません", std::nullopt, std::nullopt, o});
            }
            else if (indexOf.count(output.nodeId) == 0)
            {
                errors.push_back({"", output.port, "outputs の参照先のノードが存在しません: " + output.nodeId,
                                  std::nullopt, std::nullopt, o});
            }
        }

        validateGraphPorts(graph, indexOf, errors);

        return errors;
    }

    // トポロジカルソート(Kahn 法)。実行順を、graph.nodes の添字の並びで返す。
    // 同順位のノードが複数ある場合、`nodes` の並び順(添字の小さい順)で決める。
    // 閉路があると、並べられたノードだけを返す(返り値の個数がノード数より少なくなる)。
    // collectStructureErrors を通ったグラフを渡すこと。
    std::vector<std::size_t> topologicalSort(const ModelGraph &graph)
    {
        const auto indexOf = buildIndexOf(graph);

        const std::size_t n = graph.nodes.size();
        std::vector<std::size_t> remaining(n, 0);           // まだ実行されていない入力の本数
        std::vector<std::vector<std::size_t>> consumers(n); // 自分の出力を使うノードの添字

        for (std::size_t i = 0; i < n; ++i) // i = 自分(入力を受け取る側)
        {
            for (const auto &input : graph.nodes[i].inputs)
            {
                if (input.source.nodeId.empty())
                {
                    continue; // グラフ入力(画像)は待つ必要がない
                }

                const std::size_t from = indexOf.at(input.source.nodeId); // 入力元の添字

                ++remaining[i];               // 自分の「待っている数」を 1 増やす
                consumers[from].push_back(i); // 入力元の「使う人の一覧」に自分を加える
            }
        }

        // remaining が 0 のノード = 今すぐ実行できるノード。
        // std::set は小さい順に並ぶので、先頭を取り出せば「添字の小さい順」になる。
        std::set<std::size_t> ready;
        for (std::size_t i = 0; i < n; ++i)
        {
            if (remaining[i] == 0)
            {
                ready.insert(i);
            }
        }

        std::vector<std::size_t> order;
        order.reserve(n);
        while (!ready.empty())
        {
            const std::size_t current = *ready.begin();
            ready.erase(ready.begin());
            order.push_back(current);

            // current の出力がそろったので、それを使うノードの待ち数を減らす
            for (const std::size_t consumer : consumers[current])
            {
                --remaining[consumer];
                if (remaining[consumer] == 0)
                {
                    ready.insert(consumer);
                }
            }
        }

        return order;
    }

    // 構造の検証と実行順の計算をまとめて行う。見つかった問題を errors に入れ、実行順を返す(問題があれば空)。
    std::vector<std::size_t> validateAndSort(const ModelGraph &graph, std::vector<GraphValidationError> &errors)
    {
        errors = collectStructureErrors(graph);
        if (!errors.empty())
        {
            return {}; // topologicalSort の前提(ID が一意、参照先が存在する)が崩れているので、閉路は調べない
        }

        std::vector<std::size_t> order = topologicalSort(graph);

        // 実行できるノードがなくなったのに、まだ残っているノードがある = 閉路
        if (order.size() != graph.nodes.size())
        {
            std::vector<bool> sorted(graph.nodes.size(), false);
            for (const std::size_t index : order)
            {
                sorted[index] = true;
            }
            std::string stuck;
            for (std::size_t i = 0; i < graph.nodes.size(); ++i)
            {
                if (!sorted[i])
                {
                    stuck += (stuck.empty() ? "" : ", ") + graph.nodes[i].id;
                }
            }
            errors.push_back({"", "", "グラフに閉路があります。実行できないノード: " + stuck});
            return {};
        }

        return order;
    }

    // 検証で見つかった問題を、例外のメッセージ用に 1 つの文字列にまとめる。
    std::string formatErrors(const std::vector<GraphValidationError> &errors)
    {
        std::string message = "Graph validation failed:";
        for (const auto &error : errors)
        {
            message += "\n  - ";
            if (!error.nodeId.empty())
            {
                message += "node '" + error.nodeId + "'";
                if (!error.port.empty())
                {
                    message += " port '" + error.port + "'";
                }
                message += ": ";
            }
            else if (error.nodeIndex.has_value())
            {
                message += "nodes[" + std::to_string(*error.nodeIndex) + "]: "; // ID が空のノードは、添字で示す
            }
            message += error.message;
        }
        return message;
    }
}

std::vector<GraphValidationError> validateGraphStructure(const ModelGraph &graph)
{
    std::vector<GraphValidationError> errors;
    validateAndSort(graph, errors);
    return errors;
}

validatedModelGraph::validatedModelGraph(ModelGraph graph, std::vector<std::size_t> order)
    : _graph(std::move(graph)), _order(std::move(order))
{
}

validatedModelGraph validatedModelGraph::create(const ModelGraph &graph)
{
    std::vector<GraphValidationError> errors;
    auto order = validateAndSort(graph, errors);
    if (!errors.empty())
    {
        throw std::runtime_error(formatErrors(errors));
    }

    return validatedModelGraph(graph, std::move(order));
}
