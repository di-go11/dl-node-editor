// ポートの検証(GraphValidation)と形状推論(GraphShapeInference)のテスト。
// libtorch に依存しない(entities だけを使う)。
//
// 小さい SegNet 型のグラフ(IndexedPooling / Unpooling を 2 組)を作り、
//   - 正しいグラフで、各ノードの出力形状が期待どおりに求まること
//   - つなぎ方の間違い(ポート名・種類・本数)を、validatedModelGraph::create が検出すること
//   - 形状の間違い(チャンネル数・サイズ・Unpooling の対応・クラス数)を、validateGraphShapes が検出すること
// を確認する。

#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

#include "training/entities/domain-objects/ModelGraph/DAG/GraphShapeInference.hpp"
#include "training/entities/domain-objects/ModelGraph/DAG/GraphValidation.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/ActivationConfig.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/ActivationType.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/BatchNormParams.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/Conv2DParams.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/IndexedPoolingParams.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/LayersConfig.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/PoolingParams.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/UnpoolingParams.hpp"
#include "training/entities/domain-objects/ModelGraph/ModelGraph.hpp"

namespace
{
    int failureCount = 0;

    void check(bool condition, const std::string &message)
    {
        std::cout << (condition ? "[PASS] " : "[FAIL] ") << message << std::endl;
        if (!condition)
        {
            ++failureCount;
        }
    }

    constexpr int64_t kNumClasses = 3;
    const FeatureMapShape kInput{3, 256, 256};

    // ---- グラフの組み立て ----

    NodeInput connect(const std::string &port, const std::string &nodeId, const std::string &sourcePort)
    {
        return NodeInput{port, PortRef{nodeId, sourcePort}};
    }

    // グラフ入力(画像)につなぐ。ノード ID もポート名も空で表す。
    NodeInput fromGraphInput(const std::string &port)
    {
        return NodeInput{port, PortRef{"", ""}};
    }

    // Conv(3x3, padding 1) - ReLU - BatchNorm を並べる。最後のノード(BatchNorm)の ID を返す。
    std::string addConvReluBn(ModelGraph &graph, const std::string &prefix, int64_t in, int64_t out,
                              const NodeInput &first)
    {
        Conv2DParams conv;
        conv.inChannels = in;
        conv.outChannels = out;
        conv.kernelSize = 3;
        conv.padding = 1;
        graph.nodes.push_back({prefix + "_conv", LayersConfig{conv}, {first}});

        ActivationConfig relu;
        relu.activationType = ActivationType::ReLU;
        graph.nodes.push_back({prefix + "_relu", LayersConfig{relu}, {connect("x", prefix + "_conv", "y")}});

        BatchNormParams bn;
        bn.numFeatures = out;
        graph.nodes.push_back({prefix + "_bn", LayersConfig{bn}, {connect("x", prefix + "_relu", "y")}});
        return prefix + "_bn";
    }

    // SegNet を小さくした構成(3 -> 4 -> 8 -> 4 -> クラス数)。
    //   enc1: Conv-ReLU-BN → IndexedPooling(p1)
    //   enc2: Conv-ReLU-BN → IndexedPooling(p2)
    //   dec2: Unpooling(u2。p2 の indices) → Conv-ReLU-BN
    //   dec1: Unpooling(u1。p1 の indices) → Conv-ReLU-BN(出力はクラス数)
    ModelGraph makeSegNetGraph()
    {
        ModelGraph graph;

        const std::string e1 = addConvReluBn(graph, "e1", 3, 4, fromGraphInput("x"));
        graph.nodes.push_back({"p1", LayersConfig{IndexedPoolingParams{}}, {connect("x", e1, "y")}});

        const std::string e2 = addConvReluBn(graph, "e2", 4, 8, connect("x", "p1", "y"));
        graph.nodes.push_back({"p2", LayersConfig{IndexedPoolingParams{}}, {connect("x", e2, "y")}});

        graph.nodes.push_back({"u2",
                               LayersConfig{UnpoolingParams{}},
                               {connect("x", "p2", "y"), connect("indices", "p2", "indices")}});
        const std::string d2 = addConvReluBn(graph, "d2", 8, 4, connect("x", "u2", "y"));

        graph.nodes.push_back({"u1",
                               LayersConfig{UnpoolingParams{}},
                               {connect("x", d2, "y"), connect("indices", "p1", "indices")}});
        const std::string d1 = addConvReluBn(graph, "d1", 4, kNumClasses, connect("x", "u1", "y"));

        graph.outputs.push_back(PortRef{d1, "y"});
        return graph;
    }

    GraphNode &nodeOf(ModelGraph &graph, const std::string &id)
    {
        for (auto &node : graph.nodes)
        {
            if (node.id == id)
            {
                return node;
            }
        }
        throw std::runtime_error("テストの組み立てミス: ノードが見つかりません: " + id);
    }

    // ---- 確認 ----

    bool hasErrorAt(const std::vector<GraphValidationError> &errors, const std::string &nodeId)
    {
        for (const auto &error : errors)
        {
            if (error.nodeId == nodeId)
            {
                return true;
            }
        }
        return false;
    }

    void printErrors(const std::vector<GraphValidationError> &errors)
    {
        for (const auto &error : errors)
        {
            std::cout << "    node '" << error.nodeId << "' port '" << error.port << "': " << error.message << std::endl;
        }
    }

    // validatedModelGraph::create が、メッセージに expected を含む例外を投げること。
    void expectCreateThrows(const ModelGraph &graph, const std::string &expected, const std::string &name)
    {
        try
        {
            validatedModelGraph::create(graph);
            check(false, name + "(例外が投げられなかった)");
        }
        catch (const std::exception &e)
        {
            const bool ok = std::string(e.what()).find(expected) != std::string::npos;
            check(ok, name);
            if (!ok)
            {
                std::cout << "    message: " << e.what() << std::endl;
            }
        }
    }

    // ---- テスト ----

    void testValidGraph()
    {
        const auto validated = validatedModelGraph::create(makeSegNetGraph());
        const GraphShapes shapes = inferGraphShapes(validated, kInput);
        check(shapes.errors.empty(), "正しいグラフ: 形状推論でエラーがない");
        printErrors(shapes.errors);

        auto indexOf = [&](const std::string &id)
        {
            const auto &nodes = validated.getGraph().nodes;
            for (std::size_t i = 0; i < nodes.size(); ++i)
            {
                if (nodes[i].id == id)
                {
                    return i;
                }
            }
            return nodes.size();
        };

        // p1: IndexedPooling の出力 y と indices(256 → 128)
        const auto &p1 = shapes.nodeOutputs[indexOf("p1")];
        check(p1.size() == 2 && std::get<FeatureMapShape>(p1[0]) == (FeatureMapShape{4, 128, 128}) &&
                  std::get<FeatureMapShape>(p1[1]) == (FeatureMapShape{4, 128, 128}),
              "p1 の出力 y・indices は (C=4, H=128, W=128)");
        const auto &p2 = shapes.nodeOutputs[indexOf("p2")];
        check(p2.size() == 2 && std::get<FeatureMapShape>(p2[0]) == (FeatureMapShape{8, 64, 64}),
              "p2 の出力は (C=8, H=64, W=64)");
        const auto &u1 = shapes.nodeOutputs[indexOf("u1")];
        check(u1.size() == 1 && std::get<FeatureMapShape>(u1[0]) == (FeatureMapShape{4, 256, 256}),
              "u1(Unpooling)の出力は (C=4, H=256, W=256)");
        const auto &d1 = shapes.nodeOutputs[indexOf("d1_bn")];
        check(d1.size() == 1 && std::get<FeatureMapShape>(d1[0]) == (FeatureMapShape{kNumClasses, 256, 256}),
              "最終出力は (C=クラス数, H=256, W=256)");

        const auto errors = validateGraphShapes(validated, kInput, kNumClasses);
        check(errors.empty(), "正しいグラフ: validateGraphShapes がエラーを返さない");
        printErrors(errors);
    }

    void testChannelMismatch()
    {
        ModelGraph graph = makeSegNetGraph();
        std::get<Conv2DParams>(nodeOf(graph, "e2_conv").layer.params).inChannels = 5; // 実際は 4
        const auto errors = validateGraphShapes(validatedModelGraph::create(graph), kInput, kNumClasses);
        check(hasErrorAt(errors, "e2_conv"), "Conv2D の in_channels の不一致を、そのノードで検出する");
        check(errors.size() == 1, "不一致のノードより先のノードでは、重ねて報告しない");
        printErrors(errors);
    }

    void testBatchNormMismatch()
    {
        ModelGraph graph = makeSegNetGraph();
        std::get<BatchNormParams>(nodeOf(graph, "e1_bn").layer.params).numFeatures = 5; // 実際は 4
        const auto errors = validateGraphShapes(validatedModelGraph::create(graph), kInput, kNumClasses);
        check(hasErrorAt(errors, "e1_bn"), "BatchNorm の num_features の不一致を検出する");
    }

    void testUnpoolingMismatch()
    {
        ModelGraph graph = makeSegNetGraph();
        // u2 の indices を、別の段(p1)のものにつなぎ替える。ポートの種類は合っているが、形状が合わない。
        nodeOf(graph, "u2").inputs[1] = connect("indices", "p1", "indices");
        const auto errors = validateGraphShapes(validatedModelGraph::create(graph), kInput, kNumClasses);
        check(hasErrorAt(errors, "u2"), "Unpooling の x と indices の形状の不一致を検出する");
        printErrors(errors);
    }

    void testOddInputSize()
    {
        // 250 は 2 回の pooling で 125 → 62 になり、Unpooling で 124 に戻るため、p1 の indices(125)と合わない。
        const auto errors = validateGraphShapes(validatedModelGraph::create(makeSegNetGraph()),
                                                FeatureMapShape{3, 250, 250}, kNumClasses);
        check(hasErrorAt(errors, "u1"), "奇数サイズの入力で、Unpooling の形状の不一致を検出する");
        printErrors(errors);
    }

    void testTooSmallInput()
    {
        const auto errors = validateGraphShapes(validatedModelGraph::create(makeSegNetGraph()),
                                                FeatureMapShape{3, 1, 1}, kNumClasses);
        check(hasErrorAt(errors, "p1"), "入力が小さすぎて、pooling の出力サイズが 1 未満になるのを検出する");
        printErrors(errors);
    }

    void testClassCountMismatch()
    {
        const auto errors = validateGraphShapes(validatedModelGraph::create(makeSegNetGraph()), kInput, kNumClasses + 1);
        check(hasErrorAt(errors, "d1_bn"), "最終出力のチャンネル数とクラス数の不一致を検出する");
        printErrors(errors);
    }

    void testOutputSizeMismatch()
    {
        // Conv → Pooling の 2 ノードだけ。出力は 128x128 になり、入力(256x256)と合わない。
        ModelGraph graph;
        Conv2DParams conv;
        conv.inChannels = 3;
        conv.outChannels = kNumClasses;
        conv.padding = 1;
        graph.nodes.push_back({"conv", LayersConfig{conv}, {fromGraphInput("x")}});
        graph.nodes.push_back({"pool", LayersConfig{PoolingParams{}}, {connect("x", "conv", "y")}});
        graph.outputs.push_back(PortRef{"pool", "y"});

        const auto errors = validateGraphShapes(validatedModelGraph::create(graph), kInput, kNumClasses);
        check(!errors.empty() && errors[0].message.find("H / W") != std::string::npos,
              "最終出力の H / W が入力と合わないのを検出する");
        printErrors(errors);
    }

    void testPortValidation()
    {
        {
            ModelGraph graph = makeSegNetGraph();
            nodeOf(graph, "e1_conv").inputs[0].port = "z";
            expectCreateThrows(graph, "入力ポート 'z'", "存在しない入力ポート名を検出する");
        }
        {
            ModelGraph graph = makeSegNetGraph();
            auto &inputs = nodeOf(graph, "u2").inputs;
            inputs.pop_back(); // indices を外す
            expectCreateThrows(graph, "必須の入力ポートがつながっていません", "必須の入力ポートの未接続を検出する");
        }
        {
            ModelGraph graph = makeSegNetGraph();
            nodeOf(graph, "e1_relu").inputs.push_back(connect("x", "e1_conv", "y"));
            expectCreateThrows(graph, "1 本しかつなげません", "可変長でないポートへの 2 本接続を検出する");
        }
        {
            ModelGraph graph = makeSegNetGraph();
            // BatchNorm には indices という出力ポートがない
            nodeOf(graph, "e2_conv").inputs[0] = connect("x", "e1_bn", "indices");
            expectCreateThrows(graph, "出力ポート 'indices'", "参照先に存在しない出力ポート名を検出する");
        }
        {
            ModelGraph graph = makeSegNetGraph();
            // Unpooling の indices(種類は Indices)に、特徴マップ(y)をつなぐ
            nodeOf(graph, "u2").inputs[1] = connect("indices", "p2", "y");
            expectCreateThrows(graph, "つなげない種類です", "PortKind の不一致(Indices に Feature)を検出する");
        }
        {
            ModelGraph graph = makeSegNetGraph();
            // Conv2D の x(Feature)に、indices をつなぐ
            nodeOf(graph, "e2_conv").inputs[0] = connect("x", "p1", "indices");
            expectCreateThrows(graph, "つなげない種類です", "PortKind の不一致(Feature に Indices)を検出する");
        }
        {
            ModelGraph graph = makeSegNetGraph();
            // グラフ入力を指すときは、ポート名も空でなければならない
            nodeOf(graph, "e1_conv").inputs[0] = connect("x", "", "image");
            expectCreateThrows(graph, "ポート名も空にしてください", "グラフ入力に空でないポート名をつけるのを検出する");
        }
        {
            ModelGraph graph = makeSegNetGraph();
            graph.outputs[0].port = "z";
            expectCreateThrows(graph, "outputs が指す出力ポート 'z'", "outputs の存在しないポート名を検出する");
        }
    }

    // validateGraphStructure は例外を投げず、問題の一覧を返す。場所は添字でもわかる。
    void testValidateGraphStructure()
    {
        check(validateGraphStructure(makeSegNetGraph()).empty(), "validateGraphStructure: 正しいグラフではエラーを返さない");
        {
            ModelGraph graph;
            graph.nodes.push_back({"a", LayersConfig{Conv2DParams{}}, {fromGraphInput("x")}});
            graph.nodes.push_back({"b", LayersConfig{Conv2DParams{}}, {connect("x", "missing", "y")}});
            graph.outputs.push_back(PortRef{"b", "y"});
            const auto errors = validateGraphStructure(graph);
            check(errors.size() == 1 && errors[0].nodeId == "b" && errors[0].nodeIndex == std::size_t{1} &&
                      errors[0].inputIndex == std::size_t{0} && !errors[0].outputIndex.has_value(),
                  "validateGraphStructure: 入力の接続の問題は、ノードと入力の添字を返す");
            printErrors(errors);
        }
        {
            ModelGraph graph = makeSegNetGraph();
            graph.outputs[0].port = "z";
            const auto errors = validateGraphStructure(graph);
            check(errors.size() == 1 && errors[0].outputIndex == std::size_t{0} && !errors[0].inputIndex.has_value(),
                  "validateGraphStructure: outputs の問題は、outputs の添字を返す");
            printErrors(errors);
        }
        {
            // a.x ← b.y、b.x ← a.y
            ModelGraph graph;
            graph.nodes.push_back({"a", LayersConfig{Conv2DParams{}}, {connect("x", "b", "y")}});
            graph.nodes.push_back({"b", LayersConfig{Conv2DParams{}}, {connect("x", "a", "y")}});
            graph.outputs.push_back(PortRef{"b", "y"});
            const auto errors = validateGraphStructure(graph);
            check(errors.size() == 1 && errors[0].message.find("閉路") != std::string::npos &&
                      errors[0].message.find("a, b") != std::string::npos,
                  "validateGraphStructure: 閉路を、例外ではなくエラーとして返す");
            printErrors(errors);
            expectCreateThrows(graph, "閉路", "閉路のあるグラフは create で例外になる");
        }
    }
} // namespace

int main()
{
    testValidGraph();
    testChannelMismatch();
    testBatchNormMismatch();
    testUnpoolingMismatch();
    testOddInputSize();
    testTooSmallInput();
    testClassCountMismatch();
    testOutputSizeMismatch();
    testPortValidation();
    testValidateGraphStructure();

    std::cout << (failureCount == 0 ? "ALL PASSED" : "FAILED: " + std::to_string(failureCount)) << std::endl;
    return failureCount == 0 ? 0 : 1;
}
