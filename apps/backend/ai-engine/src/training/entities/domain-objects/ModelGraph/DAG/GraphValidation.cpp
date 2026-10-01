#include "GraphValidation.hpp"

#include "NodeChecker.hpp"

#include <set>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace
{
    // ノードの ID から、graph.nodes の中での添字を引く表を作る。
    // ID が重複していると後のノードで上書きされるため、validateGraphStructure を通った後に使うこと。
    std::unordered_map<std::string, std::size_t> buildIndexOf(const ModelGraph &graph)
    {
        std::unordered_map<std::string, std::size_t> indexOf;
        for (std::size_t i = 0; i < graph.nodes.size(); ++i)
        {
            indexOf[graph.nodes[i].id] = i;
        }
        return indexOf;
    }

    // 規則そのもの。問題なければ空の vector を返す。
    //
    // ここで確認するのは、topologicalSort が前提にしていること(ID が一意、参照先が存在する)と、
    // outputs の指定。ポート名の確認(層の種類ごとの入力・出力ポート)は、ノード型カタログができてから足す。
    std::vector<GraphValidationError> validateGraphStructure(const ModelGraph &graph)
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
                errors.push_back({"", "", "nodes[" + std::to_string(i) + "] の ID が空です"});
                continue;
            }

            const bool inserted = indexOf.emplace(id, i).second;
            if (!inserted)
            {
                errors.push_back({id, "", "ノード ID が重複しています"});
            }
            else if (!isValidGraphNodeId(id))
            {
                errors.push_back({id, "", "ノード ID に使えない文字が含まれています(英数字・'-'・'_' のみ)"});
            }
        }

        // 各入力の参照先のノードが存在すること(空 = グラフ入力 は対象外)
        for (const auto &node : graph.nodes)
        {
            for (const auto &input : node.inputs)
            {
                const std::string &sourceId = input.source.nodeId;
                if (!sourceId.empty() && indexOf.count(sourceId) == 0)
                {
                    errors.push_back({node.id, input.port, "参照先のノードが存在しません: " + sourceId});
                }
            }
        }

        // モデルの出力。当面は 1 つだけ受け付ける
        if (graph.outputs.size() != 1)
        {
            errors.push_back({"", "", "outputs は 1 つだけ指定してください(現在 " + std::to_string(graph.outputs.size()) + " 個)"});
        }
        for (const auto &output : graph.outputs)
        {
            if (output.nodeId.empty())
            {
                errors.push_back({"", output.port, "outputs にグラフ入力は指定できません"});
            }
            else if (indexOf.count(output.nodeId) == 0)
            {
                errors.push_back({"", output.port, "outputs の参照先のノードが存在しません: " + output.nodeId});
            }
        }

        return errors;
    }

    // トポロジカルソート(Kahn 法)。実行順を、graph.nodes の添字の並びで返す。
    // 同順位のノードが複数ある場合、`nodes` の並び順(添字の小さい順)で決める。
    // 閉路があれば例外を投げる。validateGraphStructure を通ったグラフを渡すこと。
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

        // 実行できるノードがなくなったのに、まだ残っているノードがある = 閉路
        if (order.size() != n)
        {
            std::string stuck;
            for (std::size_t i = 0; i < n; ++i)
            {
                if (remaining[i] > 0)
                {
                    stuck += (stuck.empty() ? "" : ", ") + graph.nodes[i].id;
                }
            }
            throw std::runtime_error("グラフに閉路があります。実行できないノード: " + stuck);
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
            message += error.message;
        }
        return message;
    }
}

validatedModelGraph::validatedModelGraph(ModelGraph graph, std::vector<std::size_t> order)
    : _graph(std::move(graph)), _order(std::move(order))
{
}

validatedModelGraph validatedModelGraph::create(const ModelGraph &graph)
{
    const auto errors = validateGraphStructure(graph);
    if (!errors.empty())
    {
        throw std::runtime_error(formatErrors(errors));
    }

    auto order = topologicalSort(graph);
    return validatedModelGraph(graph, std::move(order));
}
