// ModelGraphArchive(writeModelGraph / readModelGraph)のラウンドトリップテスト。
//
//   - 全 5 種の層を含む ModelGraph を archive に書き → 読み戻して構造が一致すること
//   - format_version が不一致の archive は std::runtime_error になること
//
// libtorch の serialize を実際に通すが .pt ファイルは作らず、メモリ上の
// OutputArchive → 一時ファイル → InputArchive で検証する。

#include <algorithm>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

#include <torch/torch.h>

#include "training/entities/domain-objects/ModelGraph/Layers/ActivationSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/ActivationType.hpp"
#include "training/entities/domain-objects/ModelGraph/NodeSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/DAG/ModelGraphBuilder.hpp"
#include "training/entities/domain-objects/ModelGraph/ModelGraph.hpp"
#include "training/entities/domain-objects/ModelGraph/ModelGraphFingerprint.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/PoolingType.hpp"
#include "training/infrastructure/torchModel/ModelGraphArchive.hpp"

#ifndef MODEL_GRAPH_ARCHIVE_TEST_DIR
#define MODEL_GRAPH_ARCHIVE_TEST_DIR "model_graph_archive_tmp"
#endif

// Conv2D(in=3, out=21, k=3, s=1, p=1, dilation=1) 1 層のみのグラフの fingerprint。
// 正規化文字列 "v2;nodes=1:[n0]conv2d|3|21|3|1|1|1<x=.;outputs=n0.y" の FNV-1a(64bit)。
// (ノード ID は ModelGraphBuilder が付ける "n0"。"x=." は、グラフ入力を x につなぐ意味)
// DAG 化(ModelGraph を nodes / outputs にした)で、文字列の先頭を v1 → v2 にしたため値が変わった。
// 今後この値を変えるときは、それが意図したフォーマットの変更であることを確認すること。
#define EXPECTED_SIMPLE_FINGERPRINT "7905992374f76ef3"

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

ModelGraph makeFullGraph()
{
    ModelGraphBuilder graph;

    Conv2DSpec conv;
    conv.inChannels = 3;
    conv.outChannels = 16;
    conv.kernelSize = 5;
    conv.stride = 2;
    conv.padding = 1;
    conv.dilation = 2;
    graph.add(NodeSpec{conv});

    BatchNormSpec bn;
    bn.numFeatures = 16;
    bn.eps = 1e-4;
    bn.momentum = 0.05;
    graph.add(NodeSpec{bn});

    ActivationSpec act;
    act.activationType = ActivationType::Softmax;
    act.dim = 2;
    graph.add(NodeSpec{act});

    PoolingSpec pool;
    pool.type = PoolingType::Average;
    pool.kernelSize = 3;
    pool.stride = 3;
    pool.padding = 0;
    graph.add(NodeSpec{pool});

    LinearSpec lin;
    lin.inFeatures = 128;
    lin.outFeatures = 10;
    lin.bias = false;
    graph.add(NodeSpec{lin});

    return graph.build();
}
} // namespace

int main()
{
    const std::filesystem::path dir = MODEL_GRAPH_ARCHIVE_TEST_DIR;
    std::filesystem::remove_all(dir);
    std::filesystem::create_directories(dir);

    const ModelGraph original = makeFullGraph();

    // ---- ラウンドトリップ ----
    const std::filesystem::path path = dir / "graph.pt";
    {
        torch::serialize::OutputArchive archive;
        writeModelGraph(archive, original);
        archive.save_to(path.string());
    }

    ModelGraph restored;
    {
        torch::serialize::InputArchive archive;
        archive.load_from(path.string());
        restored = readModelGraph(archive);
    }

    // ---- fingerprint の後方互換 ----
    // fingerprint は checkpoint に記録され、復元時に照合される。文字列フォーマットが
    // 変わると過去の .pt がすべて読めなくなるため、既知のグラフに対する値を固定する。
    // フィールド列挙を NodeSpecFields.hpp に集約するリファクタでも
    // この値が変わらないことを確認した。
    {
        ModelGraphBuilder simple;
        Conv2DSpec conv;
        conv.inChannels = 3;
        conv.outChannels = 21;
        conv.kernelSize = 3;
        conv.stride = 1;
        conv.padding = 1;
        simple.add(NodeSpec{conv});

        const std::string fp = modelGraphFingerprint(simple.build());
        std::cout << "  (fingerprint of Conv2D(3,21,3,1,1) = " << fp << ")" << std::endl;
        check(fp == EXPECTED_SIMPLE_FINGERPRINT,
              "既知グラフの fingerprint が変わっていない(過去の .pt との互換)");
    }

    check(restored.nodes.size() == original.nodes.size(), "ノード数が一致する");
    check(modelGraphFingerprint(restored) == modelGraphFingerprint(original),
          "全フィールドが一致する (fingerprint が一致)");

    // DAG の構造(ID・入力の接続・outputs)の明示チェック。直列のグラフなので、
    // 先頭はグラフ入力(ノード ID もポート名も空)を x につなぎ、以降は直前のノードの y につなぐ。
    check(restored.nodes.size() == 5 && restored.nodes[0].id == "n0" && restored.nodes[4].id == "n4",
          "ノード ID が復元される");
    check(restored.nodes.size() == 5 &&
              restored.nodes[0].inputs.size() == 1 && restored.nodes[0].inputs[0].port == "x" &&
              restored.nodes[0].inputs[0].source.nodeId.empty() && restored.nodes[0].inputs[0].source.port.empty(),
          "グラフ入力につなぐ接続(ノード ID もポート名も空)が復元される");
    check(restored.nodes.size() == 5 &&
              restored.nodes[3].inputs.size() == 1 &&
              restored.nodes[3].inputs[0].source.nodeId == "n2" && restored.nodes[3].inputs[0].source.port == "y",
          "ノード間の接続が復元される");
    check(restored.outputs.size() == 1 && restored.outputs[0].nodeId == "n4" && restored.outputs[0].port == "y",
          "outputs が復元される");

    // 代表フィールドの明示チェック(fingerprint 任せにしない)
    if (restored.nodes.size() == 5)
    {
        const auto &conv = std::get<Conv2DSpec>(restored.nodes[0].spec);
        check(conv.outChannels == 16 && conv.kernelSize == 5 && conv.stride == 2,
              "Conv2DSpec が復元される");
        check(conv.dilation == 2, "Conv2DSpec の dilation が復元される");
        const auto &bn = std::get<BatchNormSpec>(restored.nodes[1].spec);
        check(std::abs(bn.eps - 1e-4) < 1e-12 && std::abs(bn.momentum - 0.05) < 1e-12,
              "BatchNormSpec の double フィールドが復元される");
        const auto &act = std::get<ActivationSpec>(restored.nodes[2].spec);
        check(act.activationType == ActivationType::Softmax && act.dim == 2,
              "ActivationSpec の enum / dim が復元される");
        const auto &pool = std::get<PoolingSpec>(restored.nodes[3].spec);
        check(pool.type == PoolingType::Average, "PoolingSpec の enum が復元される");
        const auto &lin = std::get<LinearSpec>(restored.nodes[4].spec);
        check(lin.bias == false && lin.inFeatures == 128, "LinearSpec の bias が復元される");
    }
    else
    {
        check(false, "ノード数が 5 でないため個別フィールド検証をスキップ");
    }

    // ---- 空グラフ ----
    {
        const std::filesystem::path emptyPath = dir / "empty.pt";
        torch::serialize::OutputArchive out;
        writeModelGraph(out, ModelGraph{});
        out.save_to(emptyPath.string());

        torch::serialize::InputArchive in;
        in.load_from(emptyPath.string());
        const ModelGraph empty = readModelGraph(in);
        check(empty.nodes.empty(), "空の ModelGraph をラウンドトリップできる");
    }

    // ---- フォーマットの固定(後方互換) ----
    // model_graph セクションのキー名・構成が変わると、既存の .pt を
    // 読むには kModelGraphArchiveVersion を上げて version 別の読み分けが要る。
    // レイアウトを不用意に変えていないことを、既知グラフのキー集合で固定する。
    {
        const std::filesystem::path pinPath = dir / "pin.pt";
        {
            ModelGraphBuilder g;
            Conv2DSpec conv;
            conv.inChannels = 3;
            conv.outChannels = 21;
            conv.kernelSize = 3;
            conv.stride = 1;
            conv.padding = 1;
            g.add(NodeSpec{conv});

            torch::serialize::OutputArchive out;
            writeModelGraph(out, g.build());
            out.save_to(pinPath.string());
        }
        torch::serialize::InputArchive in;
        in.load_from(pinPath.string());
        std::vector<std::string> keys = in.keys();
        std::sort(keys.begin(), keys.end());

        const std::vector<std::string> expected = {
            "format_version",
            "node_0_dilation", "node_0_id", "node_0_in_channels",
            "node_0_input_0_port", "node_0_input_0_source_node", "node_0_input_0_source_port",
            "node_0_input_count", "node_0_kernel_size", "node_0_kind",
            "node_0_out_channels", "node_0_padding", "node_0_stride",
            "node_count", "output_0_node", "output_0_port", "output_count"};
        check(keys == expected,
              "Conv2D 1 層の archive キー集合が固定値と一致する(フォーマット非破壊)");

        at::Tensor versionTensor;
        in.read("format_version", versionTensor);
        check(versionTensor.item<int64_t>() == kModelGraphArchiveVersion,
              "format_version が現行バージョンで書かれている");
    }

    // ---- 異常系: 未来の format_version は読めない ----
    {
        const std::filesystem::path badPath = dir / "future_version.pt";
        {
            torch::serialize::OutputArchive out;
            out.write("format_version",
                      torch::tensor(static_cast<int64_t>(kModelGraphArchiveVersion + 1)));
            out.write("node_count", torch::tensor(static_cast<int64_t>(0)));
            out.save_to(badPath.string());
        }
        bool threw = false;
        try
        {
            torch::serialize::InputArchive in;
            in.load_from(badPath.string());
            readModelGraph(in);
        }
        catch (const std::runtime_error &)
        {
            threw = true;
        }
        check(threw, "現行より新しい format_version で std::runtime_error を投げる");
    }

    // ---- 異常系: v2 以前(layers の配列だった頃)の format は読めない ----
    {
        const std::filesystem::path oldPath = dir / "old_version.pt";
        {
            torch::serialize::OutputArchive out;
            out.write("format_version", torch::tensor(static_cast<int64_t>(2)));
            out.write("layer_count", torch::tensor(static_cast<int64_t>(0)));
            out.save_to(oldPath.string());
        }
        bool threw = false;
        try
        {
            torch::serialize::InputArchive in;
            in.load_from(oldPath.string());
            readModelGraph(in);
        }
        catch (const std::runtime_error &)
        {
            threw = true;
        }
        check(threw, "v2 以前の format_version で std::runtime_error を投げる(DAG 化で互換を切った)");
    }

    std::filesystem::remove_all(dir);

    if (failureCount == 0)
    {
        std::cout << "All model graph archive tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
