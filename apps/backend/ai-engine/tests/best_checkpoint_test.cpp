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
#include "training/application/impl/TrainingResumeState.hpp"
#include "training/application/impl/TrainingStopToken.hpp"
#include "training/application/interfaces/ITrainingProgressObserver.hpp"
#include "training/entities/domain-objects/EpochReport.hpp"
#include "training/entities/domain-objects/Metrics/EpochMetrics.hpp"
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

    std::vector<unsigned int> savedLastEpochs;

    void saveLast(const CheckpointMeta &meta) override
    {
        ++saveLastCount;
        savedLastEpochs.push_back(meta.epoch);
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
// stopToken を渡すと、stopAfter 回目の評価の後に停止を要求する(学習中の StopTraining を模す)。
class FakeEvaluator : public IModelEvaluator
{
public:
    explicit FakeEvaluator(std::vector<double> mious, TrainingStopToken *stopToken = nullptr, size_t stopAfter = 0)
        : _mious(std::move(mious)), _stopToken(stopToken), _stopAfter(stopAfter) {}

    EpochMetrics evaluate(IDatasetRepository &) override
    {
        SegmentationMetricsConfig seg{};
        seg.meanIoU = _mious.at(_index++);
        EpochMetrics m{};
        m.loss = 0.5;
        m.taskMetrics = seg;
        if (_stopToken != nullptr && _index == _stopAfter)
        {
            _stopToken->requestStop();
        }
        return m;
    }

private:
    std::vector<double> _mious;
    size_t _index = 0;
    TrainingStopToken *_stopToken;
    size_t _stopAfter;
};

// 届いた通知を記録するだけの Observer。
class FakeProgressObserver : public ITrainingProgressObserver
{
public:
    std::vector<EpochReport> reports;
    int finishedCount = 0;

    void onEpochCompleted(const EpochReport &report) override { reports.push_back(report); }
    void onFinished(TrainingStatus, const std::string &) override { ++finishedCount; }
};

TrainingDatasets makeFakeDatasets()
{
    TrainingDatasets datasets;
    datasets.trainDataset = std::make_shared<FakeDataset>();
    datasets.validationDataset = std::make_shared<FakeDataset>();
    return datasets;
}

// Usecase を1回走らせ、保存の記録を持つ FakeCheckpointStore を返す。
// totalEpochs は「設定された総エポック数」。resume 時は valMious の要素数と
// 一致しない(startEpoch 以降だけ評価される)ため別引数にしている。
std::shared_ptr<FakeCheckpointStore> runUsecaseStore(const std::vector<double> &valMious,
                                                     unsigned int totalEpochs,
                                                     const TrainingResumeState &resume = {},
                                                     unsigned int saveLastEvery = 0u)
{
    auto param = std::make_shared<TrainParam>(totalEpochs, 1u);

    auto trainer = std::make_shared<FakeTrainer>();
    auto evaluator = std::make_shared<FakeEvaluator>(valMious);
    auto store = std::make_shared<FakeCheckpointStore>();

    TrainModelUsecase usecase(param, saveLastEvery, trainer, evaluator, store, std::make_shared<FakeProgressObserver>());

    usecase.execute(makeFakeDatasets(), resume);
    return store;
}

int runUsecase(const std::vector<double> &valMious)
{
    return runUsecaseStore(valMious, static_cast<unsigned int>(valMious.size()))->saveCount;
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

    // ---------- BestMetricTracker: 初期ベスト値つき構築(resume 用) ----------
    {
        BestMetricTracker t(MetricMode::Max, 0.5);
        check(t.hasBest(), "初期ベスト付き: 構築直後から hasBest");
        check(t.best() == 0.5, "初期ベスト付き: best は 0.5");
        check(!t.update(0.4), "初期ベスト付き: 初回でも悪い値なら false(上書きしない)");
        check(t.update(0.6), "初期ベスト付き: 改善なら true");
    }

    // ---------- saveLast(中断・再開用の直近チェックポイント) ----------
    {
        auto store = runUsecaseStore({0.1, 0.3, 0.2, 0.5}, 4u);
        check(store->saveLastCount == 4, "saveLast は毎エポック呼ばれる (4回)");
        check(store->savedLastEpochs == std::vector<unsigned int>({0, 1, 2, 3}),
              "saveLast の epoch は「完了したエポック」= 0,1,2,3");
    }
    {
        // save_last_every = 2 → epoch 1, 3 で保存。最終 epoch 4 は設定に関わらず保存。
        auto store = runUsecaseStore({0.1, 0.2, 0.3, 0.4, 0.5}, 5u, {}, /*saveLastEvery=*/2u);
        check(store->savedLastEpochs == std::vector<unsigned int>({1, 3, 4}),
              "saveLastEvery=2: epoch 1,3 に加えて最終 epoch 4 も保存する");
    }

    // ---------- resume: 開始エポック ----------
    {
        TrainingResumeState resume;
        resume.startEpoch = 3;
        // 総 5 エポックのうち epoch 3,4 だけ走る → 評価は 2 回
        auto store = runUsecaseStore({0.1, 0.2}, 5u, resume);
        check(store->savedLastEpochs == std::vector<unsigned int>({3, 4}),
              "resume: startEpoch=3 なら epoch 3,4 だけ実行される");
    }
    {
        TrainingResumeState resume;
        resume.startEpoch = 5;
        auto store = runUsecaseStore({}, 5u, resume);
        check(store->saveCount == 0 && store->saveLastCount == 0,
              "resume: startEpoch が総エポック数以上なら 1 エポックも走らない");
    }

    // ---------- resume: ベスト指標の引き継ぎ ----------
    {
        TrainingResumeState resume;
        resume.startEpoch = 2;
        resume.initialBest = 0.5;
        resume.hasInitialBest = true;
        // 過去のベスト 0.5 より悪い値しか出ない → best は一度も更新されない
        auto store = runUsecaseStore({0.4, 0.3}, 4u, resume);
        check(store->saveCount == 0,
              "resume: 旧ベストを引き継ぐと、悪い指標で best.pt を上書きしない");
    }
    {
        // 引き継がない場合は最初のエポックが「初回 = 改善」扱いになってしまう
        // (= 引き継ぎが必要な理由の裏取り)
        TrainingResumeState resume;
        resume.startEpoch = 2;
        auto store = runUsecaseStore({0.4, 0.3}, 4u, resume);
        check(store->saveCount == 1,
              "resume: 引き継がないと初回扱いで best が上書きされる(引き継ぎが必要な理由)");
    }

    // ---------- 進捗の通知(ITrainingProgressObserver) ----------
    {
        auto observer = std::make_shared<FakeProgressObserver>();
        TrainModelUsecase usecase(std::make_shared<TrainParam>(3u, 1u), 0u,
                                  std::make_shared<FakeTrainer>(), std::make_shared<FakeEvaluator>(std::vector<double>{0.1, 0.2, 0.3}),
                                  std::make_shared<FakeCheckpointStore>(), observer);
        const TrainingStatus status = usecase.execute(makeFakeDatasets());

        check(status == TrainingStatus::Completed, "通知: 最後まで回れば Completed を返す");
        check(observer->reports.size() == 3, "通知: onEpochCompleted がエポックごとに呼ばれる (3回)");
        check(observer->reports.size() == 3 &&
                  observer->reports[0].epoch == 0 && observer->reports[2].epoch == 2,
              "通知: epoch は 0,1,2");
        check(observer->reports.size() == 3 &&
                  observer->reports[1].trainLoss == 1.0 && observer->reports[1].validation.loss == 0.5,
              "通知: 学習側の loss と検証側の loss が入る");
        check(observer->reports.size() == 3 &&
                  std::get<SegmentationMetricsConfig>(observer->reports[2].validation.taskMetrics).meanIoU == 0.3,
              "通知: 検証側の TaskMetrics が入る");
        check(observer->reports.size() == 3 &&
                  observer->reports[2].totalElapsedMs >= observer->reports[2].epochElapsedMs,
              "通知: 累計時間 >= そのエポックの時間");
        check(observer->finishedCount == 0, "通知: onFinished は usecase からは呼ばれない(呼び出し側の責務)");
    }
    {
        // resume で 1 エポックも走らない場合も Completed(学習はすでに終わっている)
        TrainingResumeState resume;
        resume.startEpoch = 3;
        auto observer = std::make_shared<FakeProgressObserver>();
        TrainModelUsecase usecase(std::make_shared<TrainParam>(3u, 1u), 0u,
                                  std::make_shared<FakeTrainer>(), std::make_shared<FakeEvaluator>(std::vector<double>{}),
                                  std::make_shared<FakeCheckpointStore>(), observer);
        check(usecase.execute(makeFakeDatasets(), resume) == TrainingStatus::Completed && observer->reports.empty(),
              "通知: 実行するエポックがなければ通知なしで Completed");
    }

    // ---------- 停止(TrainingStopToken) ----------
    {
        // 開始前に停止が要求されていれば 1 エポックも回さない
        TrainingStopToken token;
        token.requestStop();
        auto observer = std::make_shared<FakeProgressObserver>();
        auto store = std::make_shared<FakeCheckpointStore>();
        TrainModelUsecase usecase(std::make_shared<TrainParam>(3u, 1u), 0u,
                                  std::make_shared<FakeTrainer>(), std::make_shared<FakeEvaluator>(std::vector<double>{0.1, 0.2, 0.3}),
                                  store, observer);
        const TrainingStatus status = usecase.execute(makeFakeDatasets(), {}, &token);

        check(status == TrainingStatus::Stopped, "停止(開始前): Stopped を返す");
        check(observer->reports.empty() && store->saveLastCount == 0, "停止(開始前): 1 エポックも回さない");
    }
    {
        // 2 エポック目の評価の後に停止要求 → そのエポックを終えて抜ける。
        // saveLastEvery=10 でも、抜けるエポックの last は必ず保存する(そこから再開できるように)。
        TrainingStopToken token;
        auto observer = std::make_shared<FakeProgressObserver>();
        auto store = std::make_shared<FakeCheckpointStore>();
        TrainModelUsecase usecase(std::make_shared<TrainParam>(5u, 1u), /*saveLastEvery=*/10u,
                                  std::make_shared<FakeTrainer>(),
                                  std::make_shared<FakeEvaluator>(std::vector<double>{0.1, 0.2, 0.3, 0.4, 0.5}, &token, /*stopAfter=*/2),
                                  store, observer);
        const TrainingStatus status = usecase.execute(makeFakeDatasets(), {}, &token);

        check(status == TrainingStatus::Stopped, "停止(学習中): Stopped を返す");
        check(observer->reports.size() == 2, "停止(学習中): 停止要求のあったエポックまで通知される (2回)");
        check(store->savedLastEpochs == std::vector<unsigned int>({1}),
              "停止(学習中): 抜けるエポック 1 の last を保存する(saveLastEvery に関わらず)");
    }
    {
        // 最終エポックで停止要求が来ても、学習は最後まで終わっているので Completed
        TrainingStopToken token;
        TrainModelUsecase usecase(std::make_shared<TrainParam>(2u, 1u), 0u,
                                  std::make_shared<FakeTrainer>(),
                                  std::make_shared<FakeEvaluator>(std::vector<double>{0.1, 0.2}, &token, /*stopAfter=*/2),
                                  std::make_shared<FakeCheckpointStore>(), std::make_shared<FakeProgressObserver>());
        check(usecase.execute(makeFakeDatasets(), {}, &token) == TrainingStatus::Completed,
              "停止(最終エポック): Completed を返す");
    }

    if (failureCount == 0)
    {
        std::cout << "All best checkpoint tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
