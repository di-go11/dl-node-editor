// CheckpointModelLoader の「checkpoint 単体からのモデル再構築」テスト。
//
// checkpoint_roundtrip_test が「保存時と同じ構造のモデルを呼び出し側が用意する」
// 前提の in-place 復元を検証するのに対し、こちらは
//   .pt のパス + OptimizerConfig だけを入力に
//   構造の復元 → モデル構築 → optimizer 構築 → 重み/状態のロード
// が通ることを検証する。
//
//   - 復元された ModelGraph が保存時と一致すること
//   - 呼び出し側が ModelGraph を一切用意せずに重みが復元されること
//   - optimizer 状態も復元され、以降の学習が連続すること
//   - meta(epoch / bestMetric)が復元されること
//   - model_graph を含まない .pt では明示的に例外になること

#include <cmath>
#include <filesystem>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include <torch/torch.h>

#include "training/adapters/interfaces/IModel.hpp"
#include "training/adapters/interfaces/IOptimizer.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/ActivationConfig.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/ActivationType.hpp"
#include "training/entities/domain-objects/CheckpointMeta.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/Conv2DParams.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/LayersConfig.hpp"
#include "training/entities/domain-objects/ModelGraph/DAG/GraphValidation.hpp"
#include "training/entities/domain-objects/ModelGraph/DAG/ModelGraphBuilder.hpp"
#include "training/entities/domain-objects/ModelGraph/ModelGraph.hpp"
#include "training/entities/domain-objects/ModelGraph/ModelGraphFingerprint.hpp"
#include "training/entities/domain-objects/OptimizerConfig.hpp"
#include "training/infrastructure/torchFunc/CrossEntropy.hpp"
#include "training/infrastructure/torchFunc/TorchLayerBuilder.hpp"
#include "training/infrastructure/torchFunc/TorchOptimizerFactory.hpp"
#include "training/infrastructure/torchModel/CheckpointArchiveIO.hpp"
#include "training/infrastructure/torchModel/CheckpointModelLoader.hpp"
#include "training/infrastructure/torchModel/ModelGraphArchive.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointStore.hpp"
#include "training/infrastructure/torchModel/TorchModel.hpp"
#include "training/infrastructure/torchModel/TorchModelFactory.hpp"

#ifndef CHECKPOINT_REBUILD_TEST_DIR
#define CHECKPOINT_REBUILD_TEST_DIR "checkpoint_rebuild_tmp"
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

// Conv → ReLU → Conv の、単層より非自明な構造。
ModelGraph makeGraph(int numClasses)
{
    ModelGraphBuilder graph;

    Conv2DParams conv1;
    conv1.inChannels = 3;
    conv1.outChannels = 4;
    conv1.kernelSize = 3;
    conv1.stride = 1;
    conv1.padding = 1;
    graph.add(LayersConfig{conv1});

    ActivationConfig act;
    act.activationType = ActivationType::ReLU;
    graph.add(LayersConfig{act});

    Conv2DParams conv2;
    conv2.inChannels = 4;
    conv2.outChannels = numClasses;
    conv2.kernelSize = 3;
    conv2.stride = 1;
    conv2.padding = 1;
    graph.add(LayersConfig{conv2});

    return graph.build();
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

void trainSteps(IModel &model, IOptimizer &optimizer, at::Tensor &input, at::Tensor &target, int n)
{
    CrossEntropy loss;
    for (int i = 0; i < n; ++i)
    {
        model.trainStep(input, target, loss, optimizer);
    }
}
} // namespace

int main()
{
    torch::manual_seed(0);

    const std::filesystem::path dir = CHECKPOINT_REBUILD_TEST_DIR;
    std::filesystem::remove_all(dir);
    std::filesystem::create_directories(dir);

    const int numClasses = 3;
    const ModelGraph graph = makeGraph(numClasses);

    AdamOptimizerConfig adamConfig;
    adamConfig.learningRate = 0.05;
    const OptimizerConfig optimizerConfig = adamConfig;

    at::Tensor input = torch::randn({1, 3, 4, 4});
    at::Tensor target = torch::randint(0, numClasses, {1, 4, 4},
                                       torch::TensorOptions().dtype(torch::kInt64));

    const unsigned int savedEpoch = 11;
    const double savedBestMetric = 0.4821;

    // ---- 保存側: factory 経由で組み、数ステップ学習して保存 ----
    auto modelFactory = std::make_shared<TorchModelFactory>();
    auto optimizerFactory = std::make_shared<TorchOptimizerFactory>();

    std::shared_ptr<IModel> srcModel = modelFactory->create(validatedModelGraph::create(graph), kTestDevice);
    std::vector<at::Tensor> srcParams = srcModel->parameters();
    std::shared_ptr<IOptimizer> srcOptimizer = optimizerFactory->create(srcParams, optimizerConfig);

    check(srcParams.size() == 4, "TorchModelFactory が Conv×2 分のパラメータ(w/b × 2)を持つモデルを作る");

    trainSteps(*srcModel, *srcOptimizer, input, target, 4);
    const std::vector<at::Tensor> savedParams = snapshot(srcParams);

    const std::filesystem::path ptPath = dir / "rebuild_best.pt";
    {
        TorchCheckpointStore store(srcModel, srcOptimizer, dir.string(), "rebuild", graph);
        store.saveBest(CheckpointMeta{savedEpoch, savedBestMetric});
    }
    check(std::filesystem::exists(ptPath), "saveBest が .pt を生成する");

    // ---- 復元側: graph を一切渡さず、.pt のパスだけで再構築 ----
    CheckpointModelLoader loader(modelFactory, optimizerFactory);
    RestoredCheckpoint restored = loader.load(ptPath.string(), optimizerConfig, kTestDevice);

    check(modelGraphFingerprint(restored.graph) == modelGraphFingerprint(graph),
          "checkpoint から復元した ModelGraph が保存時と一致する");
    check(restored.graph.nodes.size() == 3, "層数(Conv→ReLU→Conv)が復元される");
    check(restored.model != nullptr && restored.optimizer != nullptr,
          "model / optimizer が生成される");
    check(restored.meta.epoch == savedEpoch, "meta.epoch が復元される");
    check(std::fabs(restored.meta.bestMetric - savedBestMetric) < 1e-9,
          "meta.bestMetric が復元される");
    check(allClose(restored.parameters, savedParams),
          "graph を渡さずに .pt だけからモデル重みが復元される");

    // ---- optimizer 状態の連続性: 同一の追加ステップで挙動が一致するか ----
    trainSteps(*srcModel, *srcOptimizer, input, target, 1);
    trainSteps(*restored.model, *restored.optimizer, input, target, 1);
    check(allClose(srcParams, restored.parameters),
          "再構築後に同一ステップを踏むと一致する (Adam の exp_avg/exp_avg_sq/step が復元されている)");

    // ---- 異常系: 存在しないファイル ----
    {
        bool threw = false;
        try
        {
            loader.load((dir / "does_not_exist.pt").string(), optimizerConfig, kTestDevice);
        }
        catch (const std::runtime_error &)
        {
            threw = true;
        }
        check(threw, "存在しないファイルで std::runtime_error を投げる");
    }

    // ---- 異常系: model_graph を含まない(構造保存前の)checkpoint ----
    {
        const std::filesystem::path legacyPath = dir / "no_graph.pt";
        {
            // writeCheckpointArchive を使わず、構造を書かない旧レイアウトを手で作る。
            torch::serialize::OutputArchive archive;
            archive.write("epoch", torch::tensor(static_cast<int64_t>(1)));
            archive.write("best_metric", torch::tensor(0.1, torch::kFloat64));
            archive.save_to(legacyPath.string());
        }
        bool threw = false;
        try
        {
            loader.load(legacyPath.string(), optimizerConfig, kTestDevice);
        }
        catch (const std::runtime_error &)
        {
            threw = true;
        }
        check(threw, "model_graph を含まない checkpoint では明示的に例外を投げる");
    }

    // ---- 異常系: Optimizer 種別の取り違え ----
    // .pt は Adam で保存されている。SGD として読もうとすると、libtorch に
    // 状態を渡す前に optimizer_type の照合で弾かれる。
    {
        SGDOptimizerConfig sgd;
        sgd.learningRate = 0.01;
        const OptimizerConfig sgdConfig = sgd;

        bool threw = false;
        try
        {
            loader.load(ptPath.string(), sgdConfig, kTestDevice);
        }
        catch (const std::runtime_error &)
        {
            threw = true;
        }
        check(threw, "Adam で保存した checkpoint を SGD として読むと例外を投げる");
    }

    // ---- 正常系: 同じ種別なら別インスタンスの config でも読める ----
    {
        AdamOptimizerConfig adam;
        adam.learningRate = 0.001; // LR が違っても種別が同じなら読める
        const OptimizerConfig sameKind = adam;

        RestoredCheckpoint again = loader.load(ptPath.string(), sameKind, kTestDevice);
        check(allClose(again.parameters, savedParams),
              "種別が同じなら LR が違っても復元できる(LR は呼び出し側の指定)");
    }

    // ---- CPU 乱数状態の復元 ----
    // 保存時の乱数状態が復元されれば、ロード後に引く乱数列は
    // 「保存直後に引いていたはずの列」と一致する。
    // 学習ループにまだ乱数消費(シャッフル / dropout)は無いので、
    // 乱数生成を直接叩いて配線が効いていることを確認する。
    {
        const std::filesystem::path rngPtPath = dir / "rng_best.pt"; // <modelName>_best.pt

        torch::manual_seed(20240607);
        (void)torch::randn({7}); // 状態を非自明な位置へ進める

        {
            // この時点の乱数状態が checkpoint に記録される。
            std::shared_ptr<IModel> m = modelFactory->create(validatedModelGraph::create(graph), kTestDevice);
            std::vector<at::Tensor> p = m->parameters();
            std::shared_ptr<IOptimizer> o = optimizerFactory->create(p, optimizerConfig);
            TorchCheckpointStore store(m, o, dir.string(), "rng", graph);
            store.saveBest(CheckpointMeta{1, 0.0});
        }

        // 保存直後に引いた「基準の乱数列」。
        const at::Tensor expectedDraw = torch::randn({16});

        // 乱数状態を別の場所へ動かしてから復元する。
        torch::manual_seed(999);
        (void)torch::randn({123});

        RestoredCheckpoint rng = loader.load(rngPtPath.string(), optimizerConfig, kTestDevice);
        check(rng.rngStateRestored, "rngStateRestored が true(rng_state_cpu を読めた)");

        const at::Tensor actualDraw = torch::randn({16});
        check(torch::allclose(expectedDraw, actualDraw),
              "checkpoint ロード後の乱数列が保存時の続きと一致する");
    }

    // ---- 旧形式(rng_state_cpu 無し)は警告のみで続行 ----
    {
        const std::filesystem::path noRngPath = dir / "no_rng.pt";
        {
            // model_graph は必要なので writeModelGraph で書きつつ rng_state_cpu は書かない。
            torch::serialize::OutputArchive archive;
            torch::serialize::OutputArchive graphArchive;
            writeModelGraph(graphArchive, makeGraph(numClasses));
            archive.write("model_graph", graphArchive);
            archive.save_to(noRngPath.string());

            torch::serialize::InputArchive in;
            in.load_from(noRngPath.string());
            check(!restoreCpuRngStateIfPresent(in),
                  "rng_state_cpu を持たない archive では false を返す(続行可能)");
        }
    }

    std::filesystem::remove_all(dir);

    if (failureCount == 0)
    {
        std::cout << "All checkpoint rebuild tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
