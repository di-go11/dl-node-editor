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

#include "training/entities/domain-objects/ModelGraph/Layers/ActivationConfig.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/ActivationType.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/LayersConfig.hpp"
#include "training/entities/domain-objects/ModelGraph/ModelGraph.hpp"
#include "training/entities/domain-objects/ModelGraph/ModelGraphFingerprint.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/PoolingType.hpp"
#include "training/infrastructure/torchModel/ModelGraphArchive.hpp"

#ifndef MODEL_GRAPH_ARCHIVE_TEST_DIR
#define MODEL_GRAPH_ARCHIVE_TEST_DIR "model_graph_archive_tmp"
#endif

// Conv2D(in=3, out=21, k=3, s=1, p=1, dilation=1) 1 層のみのグラフの fingerprint。
// 正規化文字列 "v1;layers=1:[0]conv2d|3|21|3|1|1|1" の FNV-1a(64bit)。
// 2026/9/18 dilation フィールド追加(kModelGraphArchiveVersion を v1→v2 に bump)
// に伴い値が変わった。今後この値を変えるときは、それが意図した *Params の
// フィールド変更(=version bump を伴う変更)であることを確認すること。
#define EXPECTED_SIMPLE_FINGERPRINT "20a9a8897b805afd"

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
    ModelGraph graph;

    Conv2DParams conv;
    conv.inChannels = 3;
    conv.outChannels = 16;
    conv.kernelSize = 5;
    conv.stride = 2;
    conv.padding = 1;
    conv.dilation = 2;
    graph.layers.push_back(LayersConfig{conv});

    BatchNormParams bn;
    bn.numFeatures = 16;
    bn.eps = 1e-4;
    bn.momentum = 0.05;
    graph.layers.push_back(LayersConfig{bn});

    ActivationConfig act;
    act.activationType = ActivationType::Softmax;
    act.dim = 2;
    graph.layers.push_back(LayersConfig{act});

    PoolingParams pool;
    pool.type = PoolingType::Average;
    pool.kernelSize = 3;
    pool.stride = 3;
    pool.padding = 0;
    graph.layers.push_back(LayersConfig{pool});

    LinearParams lin;
    lin.inFeatures = 128;
    lin.outFeatures = 10;
    lin.bias = false;
    graph.layers.push_back(LayersConfig{lin});

    return graph;
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
    // フィールド列挙を LayersParamsFields.hpp に集約するリファクタでも
    // この値が変わらないことを確認した。
    {
        ModelGraph simple;
        Conv2DParams conv;
        conv.inChannels = 3;
        conv.outChannels = 21;
        conv.kernelSize = 3;
        conv.stride = 1;
        conv.padding = 1;
        simple.layers.push_back(LayersConfig{conv});

        const std::string fp = modelGraphFingerprint(simple);
        std::cout << "  (fingerprint of Conv2D(3,21,3,1,1) = " << fp << ")" << std::endl;
        check(fp == EXPECTED_SIMPLE_FINGERPRINT,
              "既知グラフの fingerprint が変わっていない(過去の .pt との互換)");
    }

    check(restored.layers.size() == original.layers.size(), "層数が一致する");
    check(modelGraphFingerprint(restored) == modelGraphFingerprint(original),
          "全フィールドが一致する (fingerprint が一致)");

    // 代表フィールドの明示チェック(fingerprint 任せにしない)
    if (restored.layers.size() == 5)
    {
        const auto &conv = std::get<Conv2DParams>(restored.layers[0].params);
        check(conv.outChannels == 16 && conv.kernelSize == 5 && conv.stride == 2,
              "Conv2DParams が復元される");
        check(conv.dilation == 2, "Conv2DParams の dilation が復元される");
        const auto &bn = std::get<BatchNormParams>(restored.layers[1].params);
        check(std::abs(bn.eps - 1e-4) < 1e-12 && std::abs(bn.momentum - 0.05) < 1e-12,
              "BatchNormParams の double フィールドが復元される");
        const auto &act = std::get<ActivationConfig>(restored.layers[2].params);
        check(act.activationType == ActivationType::Softmax && act.dim == 2,
              "ActivationConfig の enum / dim が復元される");
        const auto &pool = std::get<PoolingParams>(restored.layers[3].params);
        check(pool.type == PoolingType::Average, "PoolingParams の enum が復元される");
        const auto &lin = std::get<LinearParams>(restored.layers[4].params);
        check(lin.bias == false && lin.inFeatures == 128, "LinearParams の bias が復元される");
    }
    else
    {
        check(false, "層数が 5 でないため個別フィールド検証をスキップ");
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
        check(empty.layers.empty(), "空の ModelGraph をラウンドトリップできる");
    }

    // ---- フォーマットの固定(後方互換) ----
    // model_graph セクションのキー名・構成が変わると、既存の .pt を
    // 読むには kModelGraphArchiveVersion を上げて version 別の読み分けが要る。
    // レイアウトを不用意に変えていないことを、既知グラフのキー集合で固定する。
    {
        const std::filesystem::path pinPath = dir / "pin.pt";
        {
            ModelGraph g;
            Conv2DParams conv;
            conv.inChannels = 3;
            conv.outChannels = 21;
            conv.kernelSize = 3;
            conv.stride = 1;
            conv.padding = 1;
            g.layers.push_back(LayersConfig{conv});

            torch::serialize::OutputArchive out;
            writeModelGraph(out, g);
            out.save_to(pinPath.string());
        }
        torch::serialize::InputArchive in;
        in.load_from(pinPath.string());
        std::vector<std::string> keys = in.keys();
        std::sort(keys.begin(), keys.end());

        const std::vector<std::string> expected = {
            "format_version", "layer_0_dilation", "layer_0_in_channels",
            "layer_0_kernel_size", "layer_0_kind", "layer_0_out_channels",
            "layer_0_padding", "layer_0_stride", "layer_count"};
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
            out.write("layer_count", torch::tensor(static_cast<int64_t>(0)));
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

    std::filesystem::remove_all(dir);

    if (failureCount == 0)
    {
        std::cout << "All model graph archive tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
