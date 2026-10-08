// ポートの検証(GraphValidation)と形状推論(GraphShapeInference)のテスト。
// libtorch に依存しない(entities だけを使う)。
//
// 小さい SegNet 型のグラフ(IndexedPooling / Unpooling を 2 組)を作り、
//   - 正しいグラフで、各ノードの出力形状が期待どおりに求まること
//   - つなぎ方の間違い(ポート名・種類・本数)を、ValidatedModelGraph::create が検出すること
//   - 形状の間違い(チャンネル数・サイズ・Unpooling の対応・クラス数)を、validateGraphShapes が検出すること
// を確認する。

#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

#include "training/entities/domain-objects/ModelGraph/DAG/GraphShapeInference.hpp"
#include "training/entities/domain-objects/ModelGraph/DAG/GraphValidation.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/ActivationSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/ActivationType.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/BatchNormSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/Conv2DSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/IndexedPoolingSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/NodeSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/PoolingSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/UnpoolingSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/UpsampleSpec.hpp"
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
        Conv2DSpec conv;
        conv.inChannels = in;
        conv.outChannels = out;
        conv.kernelSize = 3;
        conv.padding = 1;
        graph.nodes.push_back({prefix + "_conv", NodeSpec{conv}, {first}});

        ActivationSpec relu;
        relu.activationType = ActivationType::ReLU;
        graph.nodes.push_back({prefix + "_relu", NodeSpec{relu}, {connect("x", prefix + "_conv", "y")}});

        BatchNormSpec bn;
        bn.numFeatures = out;
        graph.nodes.push_back({prefix + "_bn", NodeSpec{bn}, {connect("x", prefix + "_relu", "y")}});
        return prefix + "_bn";
    }

    // SegNet を小さくした構成(3 -> 4 -> 8 -> 4 -> クラス数)。
    //   enc1: Conv-ReLU-BN → IndexedPooling(ip1)
    //   enc2: Conv-ReLU-BN → IndexedPooling(ip2)
    //   dec2: Unpooling(u2。ip2 の indices) → Conv-ReLU-BN
    //   dec1: Unpooling(u1。ip1 の indices) → Conv-ReLU-BN(出力はクラス数)
    ModelGraph makeSegNetGraph()
    {
        ModelGraph graph;

        const std::string e1 = addConvReluBn(graph, "e1", 3, 4, fromGraphInput("x"));
        graph.nodes.push_back({"ip1", NodeSpec{IndexedPoolingSpec{}}, {connect("x", e1, "y")}});

        const std::string e2 = addConvReluBn(graph, "e2", 4, 8, connect("x", "ip1", "y"));
        graph.nodes.push_back({"ip2", NodeSpec{IndexedPoolingSpec{}}, {connect("x", e2, "y")}});

        graph.nodes.push_back({"u2",
                               NodeSpec{UnpoolingSpec{}},
                               {connect("x", "ip2", "y"), connect("indices", "ip2", "indices")}});
        const std::string d2 = addConvReluBn(graph, "d2", 8, 4, connect("x", "u2", "y"));

        graph.nodes.push_back({"u1",
                               NodeSpec{UnpoolingSpec{}},
                               {connect("x", d2, "y"), connect("indices", "ip1", "indices")}});
        const std::string d1 = addConvReluBn(graph, "d1", 4, kNumClasses, connect("x", "u1", "y"));

        graph.outputs.push_back(PortRef{d1, "y"});
        return graph;
    }

    // Upsample で拡大する構成(3 -> 4 -> 8 -> 4 -> クラス数)。SegNet 版と違い、indices の線がない。
    //   enc1: Conv-ReLU-BN → Pooling(np1)
    //   enc2: Conv-ReLU-BN → Pooling(np2)
    //   dec2: Upsample(us2) → Conv-ReLU-BN
    //   dec1: Upsample(us1) → Conv-ReLU-BN(出力はクラス数)
    ModelGraph makeUpsampleTestGraph()
    {
        ModelGraph graph;

        const std::string e1 = addConvReluBn(graph, "e1", 3, 4, fromGraphInput("x"));
        graph.nodes.push_back({"np1", NodeSpec{PoolingSpec{}}, {connect("x", e1, "y")}});

        const std::string e2 = addConvReluBn(graph, "e2", 4, 8, connect("x", "np1", "y"));
        graph.nodes.push_back({"np2", NodeSpec{PoolingSpec{}}, {connect("x", e2, "y")}});

        graph.nodes.push_back({"us2",
                               NodeSpec{UpsampleSpec{}},
                               {connect("x", "np2", "y")}});
        const std::string d2 = addConvReluBn(graph, "d2", 8, 4, connect("x", "us2", "y"));
        graph.nodes.push_back({"us1",
                               NodeSpec{UpsampleSpec{}},
                               {connect("x", d2, "y")}});
        const std::string d1 = addConvReluBn(graph, "d1", 4, kNumClasses, connect("x", "us1", "y"));

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

    // ValidatedModelGraph::create が、メッセージに expected を含む例外を投げること。
    void expectCreateThrows(const ModelGraph &graph, const std::string &expected, const std::string &name)
    {
        try
        {
            ValidatedModelGraph::create(graph);
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

    // ---- SegNet(IndexedPooling / Unpooling) ----

    void testValidSegNetGraph()
    {
        const auto validated = ValidatedModelGraph::create(makeSegNetGraph());
        const GraphShapes shapes = inferGraphShapes(validated, kInput);
        check(shapes.errors.empty(), "SegNet の正しいグラフ: 形状推論でエラーがない");
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

        // ip1: IndexedPooling の出力 y と indices(256 → 128)
        const auto &p1 = shapes.nodeOutputs[indexOf("ip1")];
        check(p1.size() == 2 && std::get<FeatureMapShape>(p1[0]) == (FeatureMapShape{4, 128, 128}) &&
                  std::get<FeatureMapShape>(p1[1]) == (FeatureMapShape{4, 128, 128}),
              "ip1 の出力 y・indices は (C=4, H=128, W=128)");
        const auto &p2 = shapes.nodeOutputs[indexOf("ip2")];
        check(p2.size() == 2 && std::get<FeatureMapShape>(p2[0]) == (FeatureMapShape{8, 64, 64}),
              "ip2 の出力は (C=8, H=64, W=64)");
        const auto &u1 = shapes.nodeOutputs[indexOf("u1")];
        check(u1.size() == 1 && std::get<FeatureMapShape>(u1[0]) == (FeatureMapShape{4, 256, 256}),
              "u1(Unpooling)の出力は (C=4, H=256, W=256)");
        const auto &d1 = shapes.nodeOutputs[indexOf("d1_bn")];
        check(d1.size() == 1 && std::get<FeatureMapShape>(d1[0]) == (FeatureMapShape{kNumClasses, 256, 256}),
              "SegNet のグラフの最終出力は (C=クラス数, H=256, W=256)");

        const auto errors = validateGraphShapes(validated, kInput, kNumClasses);
        check(errors.empty(), "SegNet の正しいグラフ: validateGraphShapes がエラーを返さない");
        printErrors(errors);
    }

    void testSegNetChannelMismatch()
    {
        ModelGraph graph = makeSegNetGraph();
        std::get<Conv2DSpec>(nodeOf(graph, "e2_conv").spec).inChannels = 5; // 実際は 4
        const auto errors = validateGraphShapes(ValidatedModelGraph::create(graph), kInput, kNumClasses);
        check(hasErrorAt(errors, "e2_conv"), "Conv2D の in_channels の不一致を、そのノードで検出する");
        check(errors.size() == 1, "不一致のノードより先のノードでは、重ねて報告しない");
        printErrors(errors);
    }

    void testSegNetBatchNormMismatch()
    {
        ModelGraph graph = makeSegNetGraph();
        std::get<BatchNormSpec>(nodeOf(graph, "e1_bn").spec).numFeatures = 5; // 実際は 4
        const auto errors = validateGraphShapes(ValidatedModelGraph::create(graph), kInput, kNumClasses);
        check(hasErrorAt(errors, "e1_bn"), "BatchNorm の num_features の不一致を検出する");
    }

    void testSegNetUnpoolingMismatch()
    {
        ModelGraph graph = makeSegNetGraph();
        // u2 の indices を、別の段(ip1)のものにつなぎ替える。ポートの種類は合っているが、形状が合わない。
        nodeOf(graph, "u2").inputs[1] = connect("indices", "ip1", "indices");
        const auto errors = validateGraphShapes(ValidatedModelGraph::create(graph), kInput, kNumClasses);
        check(hasErrorAt(errors, "u2"), "Unpooling の x と indices の形状の不一致を検出する");
        printErrors(errors);
    }

    void testSegNetOddInputSize()
    {
        // 250 は 2 回の pooling で 125 → 62 になり、Unpooling で 124 に戻るため、ip1 の indices(125)と合わない。
        const auto errors = validateGraphShapes(ValidatedModelGraph::create(makeSegNetGraph()),
                                                FeatureMapShape{3, 250, 250}, kNumClasses);
        check(hasErrorAt(errors, "u1"), "奇数サイズの入力で、Unpooling の形状の不一致を検出する");
        printErrors(errors);
    }

    void testSegNetTooSmallInput()
    {
        const auto errors = validateGraphShapes(ValidatedModelGraph::create(makeSegNetGraph()),
                                                FeatureMapShape{3, 1, 1}, kNumClasses);
        check(hasErrorAt(errors, "ip1"), "入力が小さすぎて、pooling の出力サイズが 1 未満になるのを検出する");
        printErrors(errors);
    }

    void testSegNetClassCountMismatch()
    {
        const auto errors = validateGraphShapes(ValidatedModelGraph::create(makeSegNetGraph()), kInput, kNumClasses + 1);
        check(hasErrorAt(errors, "d1_bn"), "最終出力のチャンネル数とクラス数の不一致を検出する");
        printErrors(errors);
    }

    void testOutputSizeMismatch()
    {
        // Conv → Pooling の 2 ノードだけ。出力は 128x128 になり、入力(256x256)と合わない。
        ModelGraph graph;
        Conv2DSpec conv;
        conv.inChannels = 3;
        conv.outChannels = kNumClasses;
        conv.padding = 1;
        graph.nodes.push_back({"conv", NodeSpec{conv}, {fromGraphInput("x")}});
        graph.nodes.push_back({"pool", NodeSpec{PoolingSpec{}}, {connect("x", "conv", "y")}});
        graph.outputs.push_back(PortRef{"pool", "y"});

        const auto errors = validateGraphShapes(ValidatedModelGraph::create(graph), kInput, kNumClasses);
        check(!errors.empty() && errors[0].message.find("H / W") != std::string::npos,
              "最終出力の H / W が入力と合わないのを検出する");
        printErrors(errors);
    }

    // ---- Upsample ----

    // ノード id の出力(出力ポートの順)。形状推論でそのノードまで進めなかったときは空。
    const std::vector<PortShape> &outputsOf(const GraphShapes &shapes, const ValidatedModelGraph &validated,
                                            const std::string &id)
    {
        const auto &nodes = validated.getGraph().nodes;
        for (std::size_t i = 0; i < nodes.size(); ++i)
        {
            if (nodes[i].id == id)
            {
                return shapes.nodeOutputs[i];
            }
        }
        throw std::runtime_error("テストの組み立てミス: ノードが見つかりません: " + id);
    }

    // 出力が 1 つで、その形状が expected と同じこと。
    bool isSingleFeatureMap(const std::vector<PortShape> &outputs, const FeatureMapShape &expected)
    {
        if (outputs.size() != 1)
        {
            return false;
        }
        const auto *map = std::get_if<FeatureMapShape>(&outputs[0]);
        return map != nullptr && *map == expected;
    }

    void testValidUpsampleGraph()
    {
        const auto validated = ValidatedModelGraph::create(makeUpsampleTestGraph());
        const GraphShapes shapes = inferGraphShapes(validated, kInput);
        check(shapes.errors.empty(), "Upsample の正しいグラフ: 形状推論でエラーがない");
        printErrors(shapes.errors);

        // Pooling で半分ずつになる(256 → 128 → 64)。出力は y だけで、indices はない。
        check(isSingleFeatureMap(outputsOf(shapes, validated, "np1"), FeatureMapShape{4, 128, 128}),
              "np1(Pooling)の出力は y だけで (C=4, H=128, W=128)");
        check(isSingleFeatureMap(outputsOf(shapes, validated, "np2"), FeatureMapShape{8, 64, 64}),
              "np2(Pooling)の出力は (C=8, H=64, W=64)");

        // Upsample は、チャンネル数を変えずに H / W を scaleFactor 倍にする(64 → 128 → 256)。
        check(isSingleFeatureMap(outputsOf(shapes, validated, "us2"), FeatureMapShape{8, 128, 128}),
              "us2(Upsample)の出力は (C=8, H=128, W=128)");
        check(isSingleFeatureMap(outputsOf(shapes, validated, "us1"), FeatureMapShape{4, 256, 256}),
              "us1(Upsample)の出力は (C=4, H=256, W=256)");
        check(isSingleFeatureMap(outputsOf(shapes, validated, "d1_bn"), FeatureMapShape{kNumClasses, 256, 256}),
              "Upsample のグラフの最終出力は (C=クラス数, H=256, W=256)");

        const auto errors = validateGraphShapes(validated, kInput, kNumClasses);
        check(errors.empty(), "Upsample の正しいグラフ: validateGraphShapes がエラーを返さない");
        printErrors(errors);
    }

    void testUpsampleScaleFactor()
    {
        // 倍率 4: 64 → 256。scaleFactor がそのまま掛かること。
        ModelGraph graph = makeUpsampleTestGraph();
        std::get<UpsampleSpec>(nodeOf(graph, "us2").spec).scaleFactor = 4;
        const auto validated = ValidatedModelGraph::create(graph);
        const GraphShapes shapes = inferGraphShapes(validated, kInput);
        check(isSingleFeatureMap(outputsOf(shapes, validated, "us2"), FeatureMapShape{8, 256, 256}),
              "Upsample の scale_factor = 4 で、H / W が 4 倍になる");

        // 倍率 1: 形状は変わらない。
        std::get<UpsampleSpec>(nodeOf(graph, "us2").spec).scaleFactor = 1;
        const auto validatedOne = ValidatedModelGraph::create(graph);
        const GraphShapes shapesOne = inferGraphShapes(validatedOne, kInput);
        check(isSingleFeatureMap(outputsOf(shapesOne, validatedOne, "us2"), FeatureMapShape{8, 64, 64}),
              "Upsample の scale_factor = 1 では、形状が変わらない");
    }

    void testUpsampleModeDoesNotChangeShape()
    {
        ModelGraph graph = makeUpsampleTestGraph();
        std::get<UpsampleSpec>(nodeOf(graph, "us1").spec).upsampleMode = UpsampleMode::Bilinear;
        std::get<UpsampleSpec>(nodeOf(graph, "us2").spec).upsampleMode = UpsampleMode::Bilinear;
        const auto validated = ValidatedModelGraph::create(graph);
        const GraphShapes shapes = inferGraphShapes(validated, kInput);
        check(isSingleFeatureMap(outputsOf(shapes, validated, "us1"), FeatureMapShape{4, 256, 256}),
              "Upsample の補間方法(Bilinear)は、出力の形状に影響しない");
        check(validateGraphShapes(validated, kInput, kNumClasses).empty(),
              "Upsample(Bilinear)のグラフ: validateGraphShapes がエラーを返さない");
    }

    void testUpsampleInvalidScaleFactor()
    {
        for (const int64_t invalid : {int64_t{0}, int64_t{-1}})
        {
            ModelGraph graph = makeUpsampleTestGraph();
            std::get<UpsampleSpec>(nodeOf(graph, "us2").spec).scaleFactor = invalid;
            const auto errors = validateGraphShapes(ValidatedModelGraph::create(graph), kInput, kNumClasses);
            check(hasErrorAt(errors, "us2"),
                  "Upsample の scale_factor = " + std::to_string(invalid) + " を、そのノードで検出する");
            check(errors.size() == 1, "scale_factor が不正なノードより先のノードでは、重ねて報告しない");
            printErrors(errors);
        }
    }

    void testUpsampleOutputSizeMismatch()
    {
        // us1 を 3 倍にすると、最終出力は 128 * 3 = 384 になり、入力(256)と合わない。
        // Upsample は相手(indices)と突き合わせないので、ずれは最終出力の確認で見つかる。
        ModelGraph graph = makeUpsampleTestGraph();
        std::get<UpsampleSpec>(nodeOf(graph, "us1").spec).scaleFactor = 3;
        const auto errors = validateGraphShapes(ValidatedModelGraph::create(graph), kInput, kNumClasses);
        check(hasErrorAt(errors, "d1_bn") && errors.size() == 1 &&
                  errors[0].message.find("384 x 384") != std::string::npos,
              "Upsample の倍率が pooling と釣り合わないとき、最終出力の H / W の不一致として検出する");
        printErrors(errors);
    }

    void testUpsampleOddInputSize()
    {
        // 250 は 2 回の pooling で 125 → 62 になり、2 回の Upsample で 124 → 248 にしか戻らない。
        // SegNet 版(testSegNetOddInputSize)は Unpooling の時点で見つかるが、こちらは最終出力で見つかる。
        const auto errors = validateGraphShapes(ValidatedModelGraph::create(makeUpsampleTestGraph()),
                                                FeatureMapShape{3, 250, 250}, kNumClasses);
        check(hasErrorAt(errors, "d1_bn") && errors.size() == 1 &&
                  errors[0].message.find("248 x 248") != std::string::npos,
              "奇数サイズの入力で、Upsample のグラフの最終出力が入力と合わないのを検出する");
        printErrors(errors);
    }

    void testUpsampleClassCountMismatch()
    {
        const auto errors = validateGraphShapes(ValidatedModelGraph::create(makeUpsampleTestGraph()),
                                                kInput, kNumClasses + 1);
        check(hasErrorAt(errors, "d1_bn"), "Upsample のグラフ: 最終出力のチャンネル数とクラス数の不一致を検出する");
        printErrors(errors);
    }

    void testUpsampleChannelMismatch()
    {
        // Upsample はチャンネル数を変えないので、us2(C=8)の次の Conv は in_channels = 8 でなければならない。
        ModelGraph graph = makeUpsampleTestGraph();
        std::get<Conv2DSpec>(nodeOf(graph, "d2_conv").spec).inChannels = 4; // 実際は 8
        const auto errors = validateGraphShapes(ValidatedModelGraph::create(graph), kInput, kNumClasses);
        check(hasErrorAt(errors, "d2_conv") && errors.size() == 1,
              "Upsample の後ろの Conv2D の in_channels の不一致を、そのノードで検出する");
        printErrors(errors);
    }

    void testUpsamplePortValidation()
    {
        {
            // Upsample の入力は x だけ。未接続は検出される。
            ModelGraph graph = makeUpsampleTestGraph();
            nodeOf(graph, "us2").inputs.clear();
            expectCreateThrows(graph, "必須の入力ポートがつながっていません", "Upsample の x の未接続を検出する");
        }
        {
            // Unpooling のつもりで indices をつないでも、Upsample にその入力ポートはない。
            ModelGraph graph = makeSegNetGraph();
            nodeOf(graph, "u2").spec = NodeSpec{UpsampleSpec{}};
            expectCreateThrows(graph, "入力ポート 'indices'", "Upsample に indices をつなぐのを検出する");
        }
        {
            // Upsample の x(Feature)に、IndexedPooling の indices をつなぐ
            ModelGraph graph = makeSegNetGraph();
            GraphNode &node = nodeOf(graph, "u2");
            node.spec = NodeSpec{UpsampleSpec{}};
            node.inputs = {connect("x", "ip2", "indices")};
            expectCreateThrows(graph, "つなげない種類です", "PortKind の不一致(Upsample の x に Indices)を検出する");
        }
        {
            // Upsample に indices という出力ポートはない
            ModelGraph graph = makeUpsampleTestGraph();
            nodeOf(graph, "d2_conv").inputs[0] = connect("x", "us2", "indices");
            expectCreateThrows(graph, "出力ポート 'indices'", "Upsample に存在しない出力ポート名を検出する");
        }
        {
            // IndexedPooling の y だけを使い、indices を使わない組み合わせは、無駄だが間違いではない。
            ModelGraph graph = makeSegNetGraph();
            GraphNode &node = nodeOf(graph, "u1");
            node.spec = NodeSpec{UpsampleSpec{}};
            node.inputs.pop_back(); // ip1 の indices を外す
            GraphNode &node2 = nodeOf(graph, "u2");
            node2.spec = NodeSpec{UpsampleSpec{}};
            node2.inputs.pop_back(); // ip2 の indices を外す
            const auto errors = validateGraphShapes(ValidatedModelGraph::create(graph), kInput, kNumClasses);
            check(errors.empty(), "IndexedPooling の後ろを Upsample にしても(indices を使わなくても)通る");
            printErrors(errors);
        }
    }

    void testSegNetPortValidation()
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
            nodeOf(graph, "u2").inputs[1] = connect("indices", "ip2", "y");
            expectCreateThrows(graph, "つなげない種類です", "PortKind の不一致(Indices に Feature)を検出する");
        }
        {
            ModelGraph graph = makeSegNetGraph();
            // Conv2D の x(Feature)に、indices をつなぐ
            nodeOf(graph, "e2_conv").inputs[0] = connect("x", "ip1", "indices");
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
            graph.nodes.push_back({"a", NodeSpec{Conv2DSpec{}}, {fromGraphInput("x")}});
            graph.nodes.push_back({"b", NodeSpec{Conv2DSpec{}}, {connect("x", "missing", "y")}});
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
            graph.nodes.push_back({"a", NodeSpec{Conv2DSpec{}}, {connect("x", "b", "y")}});
            graph.nodes.push_back({"b", NodeSpec{Conv2DSpec{}}, {connect("x", "a", "y")}});
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
    testValidSegNetGraph();
    testSegNetChannelMismatch();
    testSegNetBatchNormMismatch();
    testSegNetUnpoolingMismatch();
    testSegNetOddInputSize();
    testSegNetTooSmallInput();
    testSegNetClassCountMismatch();
    testOutputSizeMismatch();
    testValidUpsampleGraph();
    testUpsampleScaleFactor();
    testUpsampleModeDoesNotChangeShape();
    testUpsampleInvalidScaleFactor();
    testUpsampleOutputSizeMismatch();
    testUpsampleOddInputSize();
    testUpsampleClassCountMismatch();
    testUpsampleChannelMismatch();
    testUpsamplePortValidation();
    testSegNetPortValidation();
    testValidateGraphStructure();

    std::cout << (failureCount == 0 ? "ALL PASSED" : "FAILED: " + std::to_string(failureCount)) << std::endl;
    return failureCount == 0 ? 0 : 1;
}
