#include "GraphShapeInference.hpp"

#include "training/entities/domain-objects/ModelGraph/NodeShapeRules.hpp"
#include "training/entities/domain-objects/ModelGraph/NodePorts.hpp"

#include <string>
#include <unordered_map>
#include <utility>

namespace
{
    constexpr std::size_t kNoPort = static_cast<std::size_t>(-1);

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

    // 参照先(PortRef)が指す出力の形状を引く。まだ決まっていなければ nullptr。
    // グラフ入力(ノード ID が空)は input を返す。
    //
    // ポートの検証が済んでいるので、参照先のノードとポート名は必ず存在する。
    const PortShape *resolveSource(const ModelGraph &graph,
                                   const std::unordered_map<std::string, std::size_t> &indexOf,
                                   const std::vector<std::vector<PortShape>> &nodeOutputs,
                                   const PortShape &input,
                                   const PortRef &source)
    {
        if (source.nodeId.empty())
        {
            return &input;
        }

        const std::size_t nodeIndex = indexOf.at(source.nodeId);
        const NodePortSpec sourceSpec = nodePortsOf(graph.nodes[nodeIndex].spec);
        const std::size_t outputIndex = findPort(sourceSpec.outputPorts, source.port);

        const auto &outputs = nodeOutputs[nodeIndex];
        if (outputIndex == kNoPort || outputIndex >= outputs.size())
        {
            return nullptr; // 参照先のノードで形状が決まらなかった
        }
        return &outputs[outputIndex];
    }
}

GraphShapes inferGraphShapes(const ValidatedModelGraph &validated, const FeatureMapShape &input)
{
    const ModelGraph &graph = validated.getGraph();

    std::unordered_map<std::string, std::size_t> indexOf;
    for (std::size_t i = 0; i < graph.nodes.size(); ++i)
    {
        indexOf[graph.nodes[i].id] = i;
    }

    GraphShapes result;
    result.nodeOutputs.resize(graph.nodes.size());
    const PortShape inputShape = input;

    for (const std::size_t nodeIndex : validated.getOrder())
    {
        const GraphNode &node = graph.nodes[nodeIndex];
        const NodePortSpec spec = nodePortsOf(node.spec);

        // 入力ポートの順に、流れてくる形状を集める(層の規則はこの順で受け取る)。
        // 可変長のポート(Add / Concat の x)は、つないだ本数ぶんを、つないだ順に並べる。
        std::vector<PortShape> inputs;
        bool resolved = true;
        for (const InputPortSpec &port : spec.inputPorts)
        {
            for (const NodeInput &connection : node.inputs)
            {
                if (connection.port != port.name)
                {
                    continue;
                }
                const PortShape *shape = resolveSource(graph, indexOf, result.nodeOutputs, inputShape, connection.source);
                if (shape == nullptr)
                {
                    resolved = false; // 前のノードで報告済みの問題の続き。重ねて報告しない
                    break;
                }
                inputs.push_back(*shape);
            }
            if (!resolved)
            {
                break;
            }
        }
        if (!resolved)
        {
            continue;
        }

        ShapeResult inferred = inferOutputShapes(node.spec, inputs);
        if (!inferred.ok())
        {
            result.errors.push_back({node.id, "", inferred.error, nodeIndex});
            continue;
        }
        if (inferred.outputs.size() != spec.outputPorts.size())
        {
            result.errors.push_back({node.id, "", "形状の規則が返した出力の数が、出力ポートの数と一致しません", nodeIndex});
            continue;
        }
        result.nodeOutputs[nodeIndex] = std::move(inferred.outputs);
    }

    return result;
}

std::vector<GraphValidationError> validateGraphShapes(const ValidatedModelGraph &validated,
                                                      const FeatureMapShape &input,
                                                      int64_t numClasses)
{
    GraphShapes shapes = inferGraphShapes(validated, input);
    if (!shapes.errors.empty())
    {
        return std::move(shapes.errors);
    }

    // 構造の検証で、outputs はちょうど 1 つと確認済み。
    const ModelGraph &graph = validated.getGraph();
    const PortRef &outputRef = graph.outputs.at(0);

    std::unordered_map<std::string, std::size_t> indexOf;
    for (std::size_t i = 0; i < graph.nodes.size(); ++i)
    {
        indexOf[graph.nodes[i].id] = i;
    }
    const std::size_t nodeIndex = indexOf.at(outputRef.nodeId);
    const NodePortSpec spec = nodePortsOf(graph.nodes[nodeIndex].spec);
    const std::size_t outputIndex = findPort(spec.outputPorts, outputRef.port);
    const PortShape &outputShape = shapes.nodeOutputs[nodeIndex].at(outputIndex);

    std::vector<GraphValidationError> errors;
    const auto *map = std::get_if<FeatureMapShape>(&outputShape);
    if (map == nullptr)
    {
        errors.push_back({outputRef.nodeId, outputRef.port,
                          "モデルの出力は特徴マップである必要があります(実際: " + toString(outputShape) + ")",
                          nodeIndex});
        return errors;
    }
    if (map->channels != numClasses)
    {
        errors.push_back({outputRef.nodeId, outputRef.port,
                          "モデルの出力のチャンネル数(" + std::to_string(map->channels) +
                              ")が、クラス数(" + std::to_string(numClasses) + ")と一致しません",
                          nodeIndex});
    }
    if (map->height != input.height || map->width != input.width)
    {
        errors.push_back({outputRef.nodeId, outputRef.port,
                          "モデルの出力の H / W(" + std::to_string(map->height) + " x " + std::to_string(map->width) +
                              ")が、入力(" + std::to_string(input.height) + " x " + std::to_string(input.width) +
                              ")と一致しません",
                          nodeIndex});
    }
    return errors;
}
