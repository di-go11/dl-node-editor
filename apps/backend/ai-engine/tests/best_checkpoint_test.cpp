#include <cmath>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

#include <torch/torch.h>

#include "training/entities/domain-objects/TrainingBatch.hpp"
#include "training/entities/domain-objects/CheckpointMeta.hpp"
#include "training/application/interfaces/ICheckpointStore.hpp"
#include "training/application/interfaces/IModelTrainer.hpp"
#include "training/application/interfaces/IModelEvaluator.hpp"
#include "training/application/interfaces/IDatasetRepository.hpp"
#include "training/application/impl/TrainModelUsecase.hpp"
#include "training/application/impl/TrainingDatasets.hpp"
#include "training/application/impl/BestMetricTracker.hpp"
#include "training/entities/domain-objects/AppConfig.hpp"
#include "training/entities/domain-objects/EpochMetrics.hpp"
#include "training/entities/domain-objects/TrainParam.hpp"

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

class FakeCheckpointStore : public ICheckpointStore
{
public:
    int saveCount = 0; // saveBest の呼び出し回数(Usecase の保存判断を検証する)
    int saveLastCount = 0;
    std::vector<unsigned int> savedEpochs;
    CheckpointMeta lastSaved;

    void saveBest(const CheckpointMeta &meta) override
    {
        ++saveCount;
        savedEpochs.push_back(meta.epoch);
        lastSaved = meta;
    }

    void saveLast(const CheckpointMeta &meta) override
    {
        ++saveLastCount;
        lastSaved = meta;
    }

    CheckpointMeta loadBest() override { return lastSaved; }
    CheckpointMeta loadLast() override { return lastSaved; }
    CheckpointMeta loadFrom(const std::string &) override { return lastSaved; }
};

class FakeDataset : public IDatasetRepository
{
public:
    void reset() override {}
    bool hasNext() const override { return false; }
    TrainingBatch getNextBatch() override { return {}; }
};

// train は毎エポック固定の loss を返すだけ。
class FakeTrainer : public IModelTrainer
{
public:
    EpochMetrics trainOneEpoch(IDatasetRepository &) override
    {
        EpochMetrics m;
        m.loss = 1.0;
        return m;
    }
};

// evaluate は与えられた mIoU 列を順に返す。
class FakeEvaluator : public IModelEvaluator
{
public:
    explicit FakeEvaluator(std::vector<double> mious) : _mious(std::move(mious)) {}

    EpochMetrics evaluate(IDatasetRepository &) override
    {
        EpochMetrics m;
        m.meanIoU = _mious.at(_index++);
        return m;
    }

private:
    std::vector<double> _mious;
    size_t _index = 0;
};

int runUsecase(const std::vector<double> &valMious)
{
    auto param = std::make_shared<TrainParam>(static_cast<unsigned int>(valMious.size()), 1u);
    AppConfig appConfig;
    appConfig.modelName = "test";
    appConfig.outputDir = "build/test_checkpoints";

    auto trainer = std::make_shared<FakeTrainer>();
    auto evaluator = std::make_shared<FakeEvaluator>(valMious);
    auto store = std::make_shared<FakeCheckpointStore>();

    TrainModelUsecase usecase(param, appConfig, trainer, evaluator, store);

    TrainingDatasets datasets;
    datasets.trainDataset = std::make_shared<FakeDataset>();
    datasets.validationDataset = std::make_shared<FakeDataset>();

    usecase.execute(datasets);
    return store->saveCount;
}
} // namespace

int main()
{
    // ---------- BestMetricTracker ----------
    {
        BestMetricTracker t(MetricMode::Max);
        check(t.update(0.1), "Max: 初回は true");
        check(!t.update(0.1), "Max: 同値は false");
        check(t.update(0.2), "Max: 改善は true");
        check(!t.update(0.15), "Max: 悪化は false");
        check(!t.update(std::nan("")), "Max: NaN は false");
        check(t.best() == 0.2, "Max: best は 0.2 のまま");
    }
    {
        BestMetricTracker t(MetricMode::Min);
        check(t.update(1.0), "Min: 初回は true");
        check(t.update(0.5), "Min: 減少は true");
        check(!t.update(0.8), "Min: 増加は false");
    }

    // ---------- Usecase のチェックポイント保存判断 ----------
    check(runUsecase({0.1, 0.3, 0.2, 0.5}) == 3, "改善したエポックだけ保存 (3回)");
    check(runUsecase({0.5, 0.4, 0.3}) == 1, "初回以降改善なしなら1回");
    check(runUsecase({0.2, 0.2, 0.2}) == 1, "同値は保存しない (1回)");
    check(runUsecase({std::nan(""), 0.1}) == 1, "NaN はスキップ、次で初回保存 (1回)");

    if (failureCount == 0)
    {
        std::cout << "All best checkpoint tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
