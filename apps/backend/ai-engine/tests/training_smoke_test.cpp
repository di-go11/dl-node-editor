// 実データ(PASCAL VOC 形式)で学習パイプラインが端から端まで正しく動くことの
// スモークテスト。
//
// 収束まで回すのが目的ではなく、以下を確認する:
//   - VocDatasetRepository → 変換 → forward → loss → backward → optimizer.step が
//     実データで例外なく回る(Letterbox 余白の ignore_index=255 を含むマスクでも)
//   - 数エポックで train loss が下がる(勾配が正しく流れている証拠)
//   - validation 指標が有限で [0,1] に収まる
//   - checkpoint が保存でき、CheckpointModelLoader で再構築 → 再開できる
//
// 実データ(<repo>/TrainingDataset/train)が無い環境では skip する(CI 可搬性のため)。
// 本物から数サンプルだけコピーした一時 VOC ディレクトリを作って回す。

#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

#include <torch/torch.h>

#include "training/entities/domain-objects/ComputeDevice.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/Conv2DSpec.hpp"
#include "training/entities/domain-objects/DataSpecs/DataSpec.hpp"
#include "training/entities/domain-objects/DatasetSplit.hpp"
#include "training/entities/domain-objects/Metrics/EpochMetrics.hpp"
#include "training/entities/domain-objects/ModelGraph/NodeSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/DAG/GraphValidation.hpp"
#include "training/entities/domain-objects/ModelGraph/DAG/ModelGraphBuilder.hpp"
#include "training/entities/domain-objects/ModelGraph/ModelGraph.hpp"
#include "training/entities/domain-objects/OptimizerConfig.hpp"
#include "training/entities/domain-objects/TrainParam.hpp"
#include "training/entities/image/ColorLabelMap.hpp"

#include "training/adapters/impl/TorchModelTrainer.hpp"
#include "training/adapters/impl/ConsoleProgressObserver.hpp"
#include "training/adapters/interfaces/IModel.hpp"
#include "training/adapters/interfaces/IOptimizer.hpp"

#include "training/application/impl/TrainModelUsecase.hpp"
#include "training/application/impl/TrainingDatasets.hpp"
#include "training/application/impl/TrainingResumeState.hpp"

#include "training/infrastructure/dataset/DatasetLabelMap.hpp"
#include "training/infrastructure/dataset/DatasetRepositoryFactory.hpp"
#include "training/infrastructure/image/OpenCvImageDecoder.hpp"
#include "training/entities/image/LetterboxPolicy.hpp"
#include "training/infrastructure/torchFunc/CrossEntropy.hpp"
#include "training/infrastructure/torchFunc/TorchOptimizerFactory.hpp"
#include "training/infrastructure/torchModel/CheckpointModelLoader.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointStore.hpp"
#include "training/infrastructure/torchModel/TorchModelEvaluator.hpp"
#include "training/infrastructure/torchModel/TorchModelFactory.hpp"
#include "training/adapters/impl/timer/NullTimeRecorder.hpp"
#include "training/adapters/impl/parallelProcessFn/SequentialExecutor.hpp"

#ifndef SMOKE_SRC_DATASET
#define SMOKE_SRC_DATASET "TrainingDataset/train"
#endif
#ifndef SMOKE_TMP_DIR
#define SMOKE_TMP_DIR "training_smoke_tmp"
#endif
#ifndef SMOKE_DEVICE
#define SMOKE_DEVICE "cpu"
#endif

namespace fs = std::filesystem;

namespace
{
    // 実行 device は CMake の -DSMOKE_DEVICE で切り替える(既定 cpu)。
    // CUDA 指定でも torch::cuda が使えない環境では CPU にフォールバックする
    // (GPU ランナー無しでもこのテストが走るように)。
    ComputeDevice resolveTestDevice()
    {
        ComputeDevice requested = parseComputeDevice(SMOKE_DEVICE);
        if (requested.type == ComputeDeviceType::Cuda && !torch::cuda::is_available())
        {
            std::cout << "[info] SMOKE_DEVICE=" << SMOKE_DEVICE
                      << " but CUDA is unavailable; falling back to cpu." << std::endl;
            return ComputeDevice{ComputeDeviceType::Cpu, 0};
        }
        return requested;
    }

    const ComputeDevice kTestDevice = resolveTestDevice();

    int failureCount = 0;

    void check(bool cond, const std::string &msg)
    {
        std::cout << (cond ? "[PASS] " : "[FAIL] ") << msg << std::endl;
        if (!cond)
        {
            ++failureCount;
        }
    }

    constexpr int64_t kIgnoreIndex = 255;

    std::vector<std::string> readIds(const fs::path &listFile, std::size_t limit)
    {
        std::ifstream f(listFile);
        std::vector<std::string> ids;
        std::string line;
        while (ids.size() < limit && std::getline(f, line))
        {
            const auto s = line.find_first_not_of(" \t\r\n");
            if (s == std::string::npos)
            {
                continue;
            }
            const auto e = line.find_last_not_of(" \t\r\n");
            ids.push_back(line.substr(s, e - s + 1));
        }
        return ids;
    }

    fs::path resolveJpeg(const fs::path &jpegDir, const std::string &id)
    {
        for (const char *ext : {".jpg", ".jpeg"})
        {
            if (fs::exists(jpegDir / (id + ext)))
            {
                return jpegDir / (id + ext);
            }
        }
        return {};
    }

    // 本物の VOC から数サンプルだけ抜き出した最小データセットを tmp に作る。
    // 戻り値: 作れた train / val の件数
    struct TinySplitCounts
    {
        std::size_t train = 0;
        std::size_t val = 0;
    };

    TinySplitCounts buildTinyDataset(const fs::path &src, const fs::path &dst)
    {
        fs::remove_all(dst);
        fs::create_directories(dst / "JPEGImages");
        fs::create_directories(dst / "SegmentationClass");
        fs::create_directories(dst / "ImageSets" / "Segmentation");
        fs::copy_file(src / "labelmap.txt", dst / "labelmap.txt");

        auto copySplit = [&](const char *listName, std::size_t limit) -> std::size_t
        {
            const std::vector<std::string> ids = readIds(src / "ImageSets" / "Segmentation" / listName, limit * 3);
            std::ofstream out(dst / "ImageSets" / "Segmentation" / listName);
            std::size_t n = 0;
            for (const auto &id : ids)
            {
                if (n >= limit)
                {
                    break;
                }
                const fs::path jpg = resolveJpeg(src / "JPEGImages", id);
                const fs::path mask = src / "SegmentationClass" / (id + ".png");
                if (jpg.empty() || !fs::exists(mask))
                {
                    continue;
                }
                fs::copy_file(jpg, dst / "JPEGImages" / jpg.filename());
                fs::copy_file(mask, dst / "SegmentationClass" / mask.filename());
                out << id << "\n";
                ++n;
            }
            return n;
        };

        TinySplitCounts c;
        c.train = copySplit("train.txt", 4);
        c.val = copySplit("val.txt", 2);
        return c;
    }

    ModelGraph oneConvGraph(int numClasses)
    {
        ModelGraphBuilder g;
        Conv2DSpec conv;
        conv.inChannels = 3;
        conv.outChannels = numClasses;
        conv.kernelSize = 3;
        conv.stride = 1;
        conv.padding = 1;
        g.add(NodeSpec{conv});
        return g.build();
    }

    std::vector<at::Tensor> snapshot(const std::vector<at::Tensor> &p)
    {
        std::vector<at::Tensor> out;
        for (const auto &t : p)
        {
            out.push_back(t.detach().clone());
        }
        return out;
    }

    bool anyChanged(const std::vector<at::Tensor> &a, const std::vector<at::Tensor> &b)
    {
        for (std::size_t i = 0; i < a.size(); ++i)
        {
            if (!torch::allclose(a[i], b[i]))
            {
                return true;
            }
        }
        return false;
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

    const fs::path src = SMOKE_SRC_DATASET;
    if (!fs::exists(src / "labelmap.txt") || !fs::exists(src / "ImageSets" / "Segmentation" / "train.txt"))
    {
        std::cout << "[SKIP] 実データ " << src << " が見つからないためスモークテストをスキップします。" << std::endl;
        return 0;
    }

    const fs::path dst = SMOKE_TMP_DIR;
    const TinySplitCounts counts = buildTinyDataset(src, dst);
    check(counts.train >= 2 && counts.val >= 1,
          "本物の VOC から最小データセットを作成 (train=" + std::to_string(counts.train) +
              ", val=" + std::to_string(counts.val) + ")");
    if (counts.train < 2 || counts.val < 1)
    {
        std::cout << failureCount << " test(s) failed." << std::endl;
        return 1;
    }

    // ---- パイプライン一式(main.cpp と同じ構成) ----
    // 実データは labelmap.txt 付きの独自形式(CVAT の書き出し)なので Original として読む
    const ColorLabelMap labelMap = loadDatasetLabelMap(OriginalConfig{}, dst.string());
    const int numClasses = static_cast<int>(labelMap.entryCount());
    check(numClasses >= 2, "labelmap からクラス数を取得 (" + std::to_string(numClasses) + ")");

    auto param = std::make_shared<TrainParam>(/*epoch=*/1u, /*batch=*/1u);

    auto decoder = std::make_shared<OpenCvImageDecoder>();
    ImageSpec imageSpec;
    imageSpec.annotation = OriginalConfig{};
    imageSpec.inputWidth = 128;
    imageSpec.inputHeight = 128;
    SegmentationSpec segmentationSpec;
    segmentationSpec.ignoreIndex = static_cast<uint8_t>(kIgnoreIndex); // 損失・評価器と同じ値
    imageSpec.taskSpecs = segmentationSpec;
    const DataSpec dataSpec = imageSpec;

    // 余白 = ignore_index。評価がここを無視できるか見る
    // dataSeed を固定し、train のシャッフル順と拡張を毎回同じにする
    auto datasetRepository = std::make_shared<DatasetRepositoryFactory>(decoder, LetterboxPolicy{}, param, std::make_shared<NullTimeRecorder>(), std::make_shared<SequentialExecutor>(), /*dataSeed=*/0u);

    auto trainDs = datasetRepository->create(dataSpec, dst.string(), DatasetSplit::Train);
    auto valDs = datasetRepository->create(dataSpec, dst.string(), DatasetSplit::Validation);

    auto modelFactory = std::make_shared<TorchModelFactory>();
    auto optimizerFactory = std::make_shared<TorchOptimizerFactory>();

    const ModelGraph graph = oneConvGraph(numClasses);
    std::shared_ptr<IModel> model = modelFactory->create(ValidatedModelGraph::create(graph), kTestDevice);
    std::vector<at::Tensor> params = model->parameters();

    AdamOptimizerConfig adam;
    adam.learningRate = 0.01;
    const OptimizerConfig optimizerConfig = adam;
    std::shared_ptr<IOptimizer> optimizer = optimizerFactory->create(params, optimizerConfig);

    auto loss = std::make_shared<CrossEntropy>();
    auto trainer = std::make_shared<TorchModelTrainer>(model, loss, optimizer);
    auto evaluator = std::make_shared<TorchModelEvaluator>(*model, *loss, numClasses, imageSpec.taskSpecs);

    const std::vector<at::Tensor> initialWeights = snapshot(params);

    // ---- 自前のミニループ: 指標を直接取ってアサートする ----
    const int epochs = 25;
    std::vector<double> trainLoss;
    trainLoss.reserve(epochs);
    SegmentationMetricsConfig lastVal{};
    bool anyNonFinite = false;

    for (int e = 0; e < epochs; ++e)
    {
        const EpochMetrics tm = trainer->trainOneEpoch(*trainDs);
        const EpochMetrics vm = evaluator->evaluate(*valDs); // ← ignore_index を含むマスクで落ちないこと
        const auto &seg = std::get<SegmentationMetricsConfig>(vm.taskMetrics);
        trainLoss.push_back(tm.loss);
        lastVal = seg;
        if (!std::isfinite(tm.loss) || !std::isfinite(vm.loss) ||
            !std::isfinite(seg.pixelAccuracy) || !std::isfinite(seg.meanIoU))
        {
            anyNonFinite = true;
        }
    }

    check(!anyNonFinite, "全エポックで train/val の loss・accuracy・mIoU が有限値");
    check(trainLoss.front() > 0.0 && std::isfinite(trainLoss.front()),
          "初回 train loss が有効な正値 (" + std::to_string(trainLoss.front()) + ")");
    check(trainLoss.back() < trainLoss.front(),
          "train loss が初回より減少 (" + std::to_string(trainLoss.front()) + " -> " +
              std::to_string(trainLoss.back()) + ")");
    check(trainLoss.back() < trainLoss.front() * 0.85,
          "少数サンプルを 25 エポックで明確に過学習できる (>=15% 減)");
    check(anyChanged(initialWeights, params), "学習後にモデル重みが変化している");
    check(lastVal.pixelAccuracy >= 0.0 && lastVal.pixelAccuracy <= 1.0,
          "val pixelAccuracy が [0,1] (" + std::to_string(lastVal.pixelAccuracy) + ")");
    check(lastVal.meanIoU >= 0.0 && lastVal.meanIoU <= 1.0,
          "val mIoU が [0,1] (" + std::to_string(lastVal.meanIoU) + ")");

    // ---- TrainModelUsecase + 実 CheckpointStore で 2 エポック回して checkpoint 保存 ----
    const fs::path ckptDir = dst / "ckpt";
    {
        auto p2 = std::make_shared<TrainParam>(/*epoch=*/2u, /*batch=*/1u);
        auto store = std::make_shared<TorchCheckpointStore>(model, optimizer, ckptDir.string(), "smoke", graph);
        TrainModelUsecase usecase(p2, /*saveLastEvery=*/0u, trainer, evaluator, store, std::make_shared<ConsoleProgressObserver>());

        TrainingDatasets datasets;
        datasets.trainDataset = trainDs;
        datasets.validationDataset = valDs;

        usecase.execute(datasets); // 例外なく完走すること
    }
    check(fs::exists(ckptDir / "smoke_last.pt"), "TrainModelUsecase が _last.pt を書き出す");

    const std::vector<at::Tensor> weightsAfterUsecase = snapshot(model->parameters());

    // ---- checkpoint 単体から再構築 → 続きを学習 ----
    {
        CheckpointModelLoader loader(modelFactory, optimizerFactory);
        RestoredCheckpoint r = loader.load((ckptDir / "smoke_last.pt").string(), optimizerConfig, kTestDevice);

        check(r.model != nullptr, "checkpoint からモデルを再構築できる");
        check(allClose(r.parameters, weightsAfterUsecase),
              "再構築した重みが保存時(TrainModelUsecase 実行後)と一致する");

        // 続きを 1 エポック回して落ちないこと
        auto trainer2 = std::make_shared<TorchModelTrainer>(r.model, loss, r.optimizer);
        const EpochMetrics resumed = trainer2->trainOneEpoch(*trainDs);
        check(std::isfinite(resumed.loss), "再開後の学習ステップが有限 loss を返す");
    }

    fs::remove_all(dst);

    if (failureCount == 0)
    {
        std::cout << "All training smoke tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
