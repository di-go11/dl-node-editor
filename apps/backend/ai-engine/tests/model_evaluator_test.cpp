#include <cmath>
#include <cstdint>
#include <iostream>
#include <string>
#include <vector>

#include <torch/torch.h>

#include "training/adapters/interfaces/IModel.hpp"
#include "training/adapters/interfaces/ILoss.hpp"
#include "training/application/interfaces/IDatasetRepository.hpp"
#include "training/entities/domain-objects/EpochMetrics.hpp"
#include "training/entities/domain-objects/TrainingBatch.hpp"
#include "training/entities/image/ImageData.hpp"
#include "training/entities/image/NormalizedImageData.hpp"
#include "training/infrastructure/torchModel/TorchModelEvaluator.hpp"

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

void checkNear(double actual, double expected, const std::string &message, double tol = 1e-6)
{
    check(std::fabs(actual - expected) <= tol, message +
        " (expected " + std::to_string(expected) + ", got " + std::to_string(actual) + ")");
}

// 2クラス・2x2・バッチ1 の固定 prediction を返すだけのモデル。
class FakeModel : public IModel
{
public:
    explicit FakeModel(torch::Tensor prediction) : _prediction(std::move(prediction)) {}

    at::Tensor forward(const at::Tensor & /*input*/) override { return _prediction; }
    at::Tensor trainStep(at::Tensor &, at::Tensor &, ILoss &, IOptimizer &) override
    {
        return torch::tensor(0.0);
    }
    std::vector<at::Tensor> parameters() const override { return {}; } // 評価テストでは未使用
    void writeTo(ICheckpointWriter &) const override {}
    void readFrom(ICheckpointReader &) override {}
    void setTrain() override { ++setTrainCalls; }
    void setEval() override { ++setEvalCalls; }

    int setTrainCalls = 0;
    int setEvalCalls = 0;

private:
    torch::Tensor _prediction;
};

// 常に 0.5 を返す loss。
class FakeLoss : public ILoss
{
public:
    void lossOut(const at::Tensor &, const at::Tensor &, at::Tensor &output) override
    {
        output = torch::tensor(0.5);
    }
};

// バッチを1つだけ返すデータセット。
class SingleBatchDataset : public IDatasetRepository
{
public:
    explicit SingleBatchDataset(TrainingBatch batch) : _batch(std::move(batch)) {}

    void reset() override { _consumed = false; }
    bool hasNext() const override { return !_consumed; }
    TrainingBatch getNextBatch() override
    {
        _consumed = true;
        return _batch;
    }

private:
    TrainingBatch _batch;
    bool _consumed = false;
};

// target マスク(2x2, クラスID)から TrainingBatch を作る。入力画像の中身は評価結果に影響しない。
TrainingBatch makeBatch(const std::vector<uint8_t> &targetMask)
{
    TrainingBatch batch;

    NormalizedImageData input;
    input.shape = {2, 2, 2}; // C=2, H=2, W=2
    input.values.assign(2 * 2 * 2, 0.0f);
    batch.input.values.push_back(std::move(input));
    batch.input.num_samples = 1;

    batch.target.values.emplace_back(std::vector<size_t>{1, 2, 2}, targetMask);
    batch.target.num_samples = 1;

    return batch;
}

// [1,2,2,2] の prediction を作る。channel 次元の argmax が predictedMask になる。
torch::Tensor makePrediction(const std::vector<int64_t> &predictedMask)
{
    torch::Tensor logits = torch::zeros({1, 2, 2, 2});
    for (int64_t p = 0; p < 4; ++p)
    {
        const int64_t y = p / 2;
        const int64_t x = p % 2;
        logits[0][predictedMask[p]][y][x] = 1.0;
    }
    return logits;
}
} // namespace

int main()
{
    const std::vector<uint8_t> target = {0, 1, 1, 0};

    // ---------- 完全一致: accuracy=1, mIoU=1 ----------
    {
        FakeModel model(makePrediction({0, 1, 1, 0}));
        FakeLoss loss;
        SingleBatchDataset dataset(makeBatch(target));
        TorchModelEvaluator evaluator(model, loss, /*numClasses=*/2);

        EpochMetrics metrics = evaluator.evaluate(dataset);

        checkNear(metrics.pixelAccuracy, 1.0, "perfect: pixelAccuracy == 1.0");
        checkNear(metrics.meanIoU, 1.0, "perfect: meanIoU == 1.0");
        checkNear(metrics.loss, 0.5, "perfect: loss == 0.5");
        check(metrics.perClassIoU.size() == 2, "perfect: perClassIoU に 2 クラス分");
        check(model.setEvalCalls == 1, "perfect: setEval が1回呼ばれる");
        check(model.setTrainCalls == 1, "perfect: 評価後に setTrain へ戻す");
    }

    // ---------- 全画素をクラス0と予測: accuracy=0.5, mIoU=0.25 ----------
    {
        FakeModel model(makePrediction({0, 0, 0, 0}));
        FakeLoss loss;
        SingleBatchDataset dataset(makeBatch(target));
        TorchModelEvaluator evaluator(model, loss, /*numClasses=*/2);

        EpochMetrics metrics = evaluator.evaluate(dataset);

        // class0: TP=2, FP=2, FN=0 -> IoU=0.5 / class1: TP=0, FN=2 -> IoU=0
        checkNear(metrics.pixelAccuracy, 0.5, "all-zero: pixelAccuracy == 0.5");
        checkNear(metrics.perClassIoU[0], 0.5, "all-zero: class0 IoU == 0.5");
        checkNear(metrics.perClassIoU[1], 0.0, "all-zero: class1 IoU == 0.0");
        checkNear(metrics.meanIoU, 0.25, "all-zero: meanIoU == 0.25");
    }

    // ---------- ignore_index(255): Letterbox 余白の扱い ----------
    // 実データでは Letterbox リサイズがマスク余白を 255 で埋める。この値のピクセルが
    // 混同行列のインデックス(target*C+pred)をはみ出させ、以前は評価が
    // "shape '[2, 2]' is invalid for input of size N" で落ちていた。
    {
        // 2x2 のうち左上だけ 255(無視)。残り3画素は {1,1,0}。
        const std::vector<uint8_t> maskedTarget = {255, 1, 1, 0};
        FakeModel model(makePrediction({0, 1, 1, 0})); // 有効3画素は全て正解、無視画素の予測は 0
        FakeLoss loss;
        SingleBatchDataset dataset(makeBatch(maskedTarget));
        TorchModelEvaluator evaluator(model, loss, /*numClasses=*/2, /*ignoreIndex=*/255);

        EpochMetrics metrics = evaluator.evaluate(dataset);

        checkNear(metrics.pixelAccuracy, 1.0, "ignore: 無視画素を除けば accuracy == 1.0(落ちない)");
        checkNear(metrics.meanIoU, 1.0, "ignore: 無視画素を除けば mIoU == 1.0");
        checkNear(metrics.loss, 0.5, "ignore: loss は FakeLoss の 0.5");
    }

    // ---------- 全画素が ignore_index: 0 除算せず 0 を返す ----------
    {
        FakeModel model(makePrediction({0, 0, 0, 0}));
        FakeLoss loss;
        SingleBatchDataset dataset(makeBatch({255, 255, 255, 255}));
        TorchModelEvaluator evaluator(model, loss, /*numClasses=*/2, /*ignoreIndex=*/255);

        EpochMetrics metrics = evaluator.evaluate(dataset);

        checkNear(metrics.pixelAccuracy, 0.0, "all-ignore: pixelAccuracy == 0.0");
        checkNear(metrics.loss, 0.0, "all-ignore: loss == 0.0");
        checkNear(metrics.meanIoU, 0.0, "all-ignore: meanIoU == 0.0");
    }

    if (failureCount == 0)
    {
        std::cout << "All model evaluator tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
