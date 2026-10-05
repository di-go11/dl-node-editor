// TorchCheckpointStore の save → load ラウンドトリップテスト。
//
// FakeCheckpointStore を使う best_checkpoint_test とは別に、実際の TorchModel +
// AdamOptimizer + torch::serialize を通し、
//   - モデル重みが復元されること
//   - optimizer の内部状態(Adam の exp_avg / exp_avg_sq / step)が復元されること
//   - epoch が復元されること
//   - loadFrom(任意パス) が使えること
//   - 存在しないファイルで例外を投げること
// を検証する。
//
// 生成される .pt は CHECKPOINT_TEST_DIR(= <repo>/tests/checkpoint_roundtrip_tmp、
// CMake から絶対パスで注入)に書き出し、テスト終了時に削除する。

#include <cmath>
#include <filesystem>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include <torch/torch.h>

#include "training/entities/domain-objects/CheckpointMeta.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/Conv2DParams.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/LayersConfig.hpp"
#include "training/entities/domain-objects/ModelGraph/DAG/GraphValidation.hpp"
#include "training/entities/domain-objects/ModelGraph/DAG/ModelGraphBuilder.hpp"
#include "training/entities/domain-objects/ModelGraph/ModelGraph.hpp"
#include "training/infrastructure/torchFunc/AdamOptimizer.hpp"
#include "training/infrastructure/torchFunc/CrossEntropy.hpp"
#include "training/infrastructure/torchFunc/TorchLayerBuilder.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointArchive.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointStore.hpp"
#include "training/infrastructure/torchModel/TorchModel.hpp"

#ifndef CHECKPOINT_TEST_DIR
#define CHECKPOINT_TEST_DIR "checkpoint_roundtrip_tmp"
#endif

namespace
{
// テストは常に CPU 上で実行する。
const ComputeDevice kTestDevice{ComputeDeviceType::Cpu, 0};

int failureCount = 0;

void check(bool condition, const std::string &message)
{
    std::cout << (condition ? "[PASS] " : "[FAIL] ") << message << std::endl;
    if (!condition)
    {
        ++failureCount;
    }
}

ModelGraph makeGraph(int numClasses)
{
    ModelGraphBuilder graph;
    Conv2DParams conv;
    conv.inChannels = 3;
    conv.outChannels = numClasses;
    conv.kernelSize = 3;
    conv.stride = 1;
    conv.padding = 1;
    graph.add(LayersConfig{conv});
    return graph.build();
}

// TorchModel と、その parameters() を束ねた AdamOptimizer をまとめて構築する。
struct Bundle
{
    std::shared_ptr<TorchModel> model;
    std::shared_ptr<AdamOptimizer> optimizer;
    std::vector<at::Tensor> params; // model 内部と記憶域を共有するハンドル
};

Bundle makeBundle(const ModelGraph &graph, ILayerBuilder &builder, double lr)
{
    Bundle b;
    b.model = std::make_shared<TorchModel>(ValidatedModelGraph::create(graph), builder, kTestDevice);
    b.params = b.model->parameters();
    b.optimizer = std::make_shared<AdamOptimizer>(b.params, lr);
    return b;
}

void trainSteps(Bundle &b, at::Tensor &input, at::Tensor &target, int n)
{
    CrossEntropy loss;
    for (int i = 0; i < n; ++i)
    {
        b.model->trainStep(input, target, loss, *b.optimizer);
    }
}

std::vector<at::Tensor> snapshot(const std::vector<at::Tensor> &params)
{
    std::vector<at::Tensor> out;
    out.reserve(params.size());
    for (const auto &p : params)
    {
        out.push_back(p.detach().clone());
    }
    return out;
}

bool allClose(const std::vector<at::Tensor> &a, const std::vector<at::Tensor> &b, double tol = 1e-5)
{
    if (a.size() != b.size())
    {
        return false;
    }
    for (std::size_t i = 0; i < a.size(); ++i)
    {
        if (!torch::allclose(a[i], b[i], /*rtol=*/tol, /*atol=*/tol))
        {
            return false;
        }
    }
    return true;
}
} // namespace

int main()
{
    torch::manual_seed(0);

    const std::filesystem::path dir = CHECKPOINT_TEST_DIR;
    std::filesystem::remove_all(dir);
    std::filesystem::create_directories(dir);

    const int numClasses = 2;
    const ModelGraph graph = makeGraph(numClasses);
    TorchLayerBuilder builder;

    at::Tensor input = torch::randn({1, 3, 4, 4});
    at::Tensor target = torch::randint(0, numClasses, {1, 4, 4}, torch::TensorOptions().dtype(torch::kInt64));

    // ---- source: 数ステップ学習 → 保存 ----
    Bundle src = makeBundle(graph, builder, 0.05);
    trainSteps(src, input, target, 4); // 重みと Adam の m/v/step が非自明になる
    const std::vector<at::Tensor> savedParams = snapshot(src.params);

    const unsigned int savedEpoch = 7;
    const double savedBestMetric = 0.7314; // 復元されるか確認するための識別可能な値
    {
        TorchCheckpointStore store(src.model, src.optimizer, dir.string(), "roundtrip", graph);
        store.saveBest(CheckpointMeta{savedEpoch, savedBestMetric});
    }
    const std::filesystem::path ptPath = dir / "roundtrip_best.pt";
    check(std::filesystem::exists(ptPath), "saveBest が tests ディレクトリ配下に .pt を生成する");

    // ---- dest: 新規構築(別初期値)→ loadBest で復元 ----
    Bundle dst = makeBundle(graph, builder, 0.05);
    check(!allClose(src.params, dst.params), "復元前は初期値が異なる");

    CheckpointMeta loaded;
    {
        TorchCheckpointStore store(dst.model, dst.optimizer, dir.string(), "roundtrip", graph);
        loaded = store.loadBest();
    }
    check(loaded.epoch == savedEpoch, "loadBest が保存時の epoch を返す");
    check(std::fabs(loaded.bestMetric - savedBestMetric) < 1e-9, "loadBest が保存時の bestMetric を返す");
    check(allClose(dst.params, savedParams), "loadBest 後、モデル重みが一致する");

    // ---- optimizer 状態の復元検証: 同一の追加ステップで挙動が一致するか ----
    // Adam の更新は step 数(bias correction)と exp_avg/exp_avg_sq に依存する。
    // これらが復元されていなければ、同じ勾配でも更新量がずれて重みが一致しなくなる。
    trainSteps(src, input, target, 1);
    trainSteps(dst, input, target, 1);
    check(allClose(src.params, dst.params),
          "復元後に同一ステップを踏むと一致する (Adam の exp_avg/exp_avg_sq/step が復元されている)");

    // ---- loadFrom(任意パス): dir/modelName に依らず読める ----
    Bundle dst2 = makeBundle(graph, builder, 0.05);
    CheckpointMeta fromPath;
    {
        TorchCheckpointStore store(dst2.model, dst2.optimizer, "unused_dir", "unused_name", graph);
        fromPath = store.loadFrom(ptPath.string());
    }
    check(fromPath.epoch == savedEpoch, "loadFrom(任意パス) が epoch を返す");
    check(std::fabs(fromPath.bestMetric - savedBestMetric) < 1e-9, "loadFrom(任意パス) が bestMetric を返す");
    check(allClose(dst2.params, savedParams), "loadFrom(任意パス) 後、モデル重みが一致する");

    // ---- best / last のファイル分離: saveLast は _best.pt を壊さない ----
    Bundle other = makeBundle(graph, builder, 0.05);
    trainSteps(other, input, target, 2);
    const std::vector<at::Tensor> otherParams = snapshot(other.params);
    {
        TorchCheckpointStore store(other.model, other.optimizer, dir.string(), "roundtrip", graph);
        store.saveLast(CheckpointMeta{20, 0.5});
    }
    check(std::filesystem::exists(dir / "roundtrip_last.pt"), "saveLast は _last.pt を生成する");
    check(std::filesystem::exists(ptPath), "saveLast 後も _best.pt は残っている");

    Bundle resumeBest = makeBundle(graph, builder, 0.05);
    Bundle resumeLast = makeBundle(graph, builder, 0.05);
    {
        TorchCheckpointStore storeBest(resumeBest.model, resumeBest.optimizer, dir.string(), "roundtrip", graph);
        TorchCheckpointStore storeLast(resumeLast.model, resumeLast.optimizer, dir.string(), "roundtrip", graph);
        const CheckpointMeta b = storeBest.loadBest();
        const CheckpointMeta l = storeLast.loadLast();
        check(b.epoch == savedEpoch, "loadBest は _best.pt(epoch 7)を読む");
        check(l.epoch == 20u, "loadLast は _last.pt(epoch 20)を読む");
    }
    check(allClose(resumeBest.params, savedParams), "loadBest は _best.pt の重みを復元する");
    check(allClose(resumeLast.params, otherParams), "loadLast は _last.pt の重みを復元する");

    // ---- 異常系: 存在しないファイル ----
    bool threw = false;
    try
    {
        Bundle d = makeBundle(graph, builder, 0.05);
        TorchCheckpointStore store(d.model, d.optimizer, "unused_dir", "unused_name", graph);
        store.loadFrom((dir / "does_not_exist.pt").string());
    }
    catch (const std::runtime_error &)
    {
        threw = true;
    }
    check(threw, "loadFrom は存在しないファイルで std::runtime_error を投げる");

    // ---- 異常系: モデル構造(fingerprint)不一致 ----
    // roundtrip_best.pt は numClasses=2 の graph で保存されている。
    // 別構造(numClasses=3)の model/graph で読むと fingerprint 照合で弾かれる。
    {
        const ModelGraph otherGraph = makeGraph(numClasses + 1);
        Bundle mism = makeBundle(otherGraph, builder, 0.05);
        TorchCheckpointStore store(mism.model, mism.optimizer, dir.string(), "roundtrip", otherGraph);
        bool mismThrew = false;
        try
        {
            store.loadBest();
        }
        catch (const std::runtime_error &)
        {
            mismThrew = true;
        }
        check(mismThrew, "loadBest はモデル構造が一致しない checkpoint で std::runtime_error を投げる");
    }

    // ---- 後方互換: fingerprint キーの無い旧形式 checkpoint は警告のみで読める ----
    {
        const std::filesystem::path legacyPath = dir / "legacy.pt";
        {
            // fingerprint を書かずに model/optimizer/epoch/best_metric だけの archive を作る。
            Bundle legacySrc = makeBundle(graph, builder, 0.05);
            trainSteps(legacySrc, input, target, 2);
            torch::serialize::OutputArchive archive;
            torch::serialize::OutputArchive modelArchive;
            TorchCheckpointWriter modelWriter(modelArchive);
            legacySrc.model->writeTo(modelWriter);
            archive.write("model", modelArchive);
            torch::serialize::OutputArchive optimArchive;
            TorchCheckpointWriter optimWriter(optimArchive);
            legacySrc.optimizer->writeTo(optimWriter);
            archive.write("optimizer", optimArchive);
            archive.write("epoch", torch::tensor(static_cast<int64_t>(3)));
            archive.write("best_metric", torch::tensor(0.25, torch::kFloat64));
            archive.save_to(legacyPath.string());
        }
        Bundle legacyDst = makeBundle(graph, builder, 0.05);
        TorchCheckpointStore store(legacyDst.model, legacyDst.optimizer, "unused_dir", "unused_name", graph);
        bool legacyThrew = false;
        CheckpointMeta legacyMeta;
        try
        {
            legacyMeta = store.loadFrom(legacyPath.string());
        }
        catch (const std::runtime_error &)
        {
            legacyThrew = true;
        }
        check(!legacyThrew && legacyMeta.epoch == 3u,
              "fingerprint の無い旧形式 checkpoint は例外にならず読める(構造チェックはスキップ)");
    }

    std::filesystem::remove_all(dir); // 後片付け

    if (failureCount == 0)
    {
        std::cout << "All checkpoint roundtrip tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
