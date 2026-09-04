// ModelGraphArchive(writeModelGraph / readModelGraph)のラウンドトリップテスト。
//
//   - 全 5 種の層を含む ModelGraph を archive に書き → 読み戻して構造が一致すること
//   - format_version が不一致の archive は std::runtime_error になること
//
// libtorch の serialize を実際に通すが .pt ファイルは作らず、メモリ上の
// OutputArchive → 一時ファイル → InputArchive で検証する。

#include <filesystem>
#include <iostream>
#include <string>

#include <torch/torch.h>

#include "training/entities/domain-objects/ActivationConfig.hpp"
#include "training/entities/domain-objects/ActivationType.hpp"
#include "training/entities/domain-objects/LayersConfig.hpp"
#include "training/entities/domain-objects/ModelGraph.hpp"
#include "training/entities/domain-objects/ModelGraphFingerprint.hpp"
#include "training/entities/domain-objects/PoolingType.hpp"
#include "training/infrastructure/torchModel/ModelGraphArchive.hpp"

#ifndef MODEL_GRAPH_ARCHIVE_TEST_DIR
#define MODEL_GRAPH_ARCHIVE_TEST_DIR "model_graph_archive_tmp"
#endif

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

    check(restored.layers.size() == original.layers.size(), "層数が一致する");
    check(modelGraphFingerprint(restored) == modelGraphFingerprint(original),
          "全フィールドが一致する (fingerprint が一致)");

    // 代表フィールドの明示チェック(fingerprint 任せにしない)
    if (restored.layers.size() == 5)
    {
        const auto &conv = std::get<Conv2DParams>(restored.layers[0].params);
        check(conv.outChannels == 16 && conv.kernelSize == 5 && conv.stride == 2,
              "Conv2DParams が復元される");
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

    // ---- 異常系: format_version 不一致 ----
    {
        const std::filesystem::path badPath = dir / "bad_version.pt";
        {
            torch::serialize::OutputArchive out;
            out.write("format_version", torch::tensor(static_cast<int64_t>(999)));
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
        check(threw, "非対応の format_version で std::runtime_error を投げる");
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
