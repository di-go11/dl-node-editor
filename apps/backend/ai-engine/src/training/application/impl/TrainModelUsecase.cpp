#include "./TrainModelUsecase.hpp"

#include "../../entities/domain-objects/TrainParam.hpp"
#include "../../entities/domain-objects/EpochReport.hpp"
#include "../../entities/domain-objects/Metrics/EpochMetrics.hpp"
#include "../../entities/domain-objects/Metrics/MonitoredMetric.hpp"
#include "training/application/impl/TrainingDatasets.hpp"
#include "training/application/impl/BestMetricTracker.hpp"
#include "training/application/impl/TrainingStopToken.hpp"
#include "../interfaces/IModelTrainer.hpp"
#include "training/application/interfaces/IModelEvaluator.hpp"
#include "training/application/interfaces/ICheckpointStore.hpp"
#include "training/application/interfaces/ITrainingProgressObserver.hpp"

#include <chrono>
#include <cstdint>
#include <exception>
#include <iostream>
#include <optional>

namespace
{
    uint64_t elapsedMs(std::chrono::steady_clock::time_point since)
    {
        return static_cast<uint64_t>(
            std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - since).count());
    }
}

TrainModelUsecase::TrainModelUsecase(const std::shared_ptr<TrainParam> &param,
                                     unsigned int saveLastEvery,
                                     const std::shared_ptr<IModelTrainer> &trainer,
                                     const std::shared_ptr<IModelEvaluator> &evaluator,
                                     const std::shared_ptr<ICheckpointStore> &checkpointStore,
                                     const std::shared_ptr<ITrainingProgressObserver> &progressObserver)
    : _param(param),
      _saveLastEvery(saveLastEvery),
      _trainer(trainer),
      _evaluator(evaluator),
      _checkpointStore(checkpointStore),
      _progressObserver(progressObserver) {}

TrainingStatus TrainModelUsecase::execute(const TrainingDatasets &datasets,
                                          const TrainingResumeState &resume,
                                          const TrainingStopToken *stopToken)
{
    const unsigned int totalEpochs = _param->getEpochSize();
    const auto isStopRequested = [stopToken]
    { return stopToken != nullptr && stopToken->isStopRequested(); };

    if (resume.startEpoch >= totalEpochs)
    {
        // 保存済みの進捗が設定された総エポック数に既に達している。
        // 黙って 0 エポック回すと「学習した」と誤解されるため明示的に知らせる。
        std::cout << "resume: startEpoch=" << resume.startEpoch
                  << " が総エポック数 " << totalEpochs
                  << " 以上のため、実行するエポックがありません。" << std::endl;
        return TrainingStatus::Completed;
    }

    // 開始前に停止が要求されていれば、1エポックも回さずに抜ける。
    if (isStopRequested())
    {
        return TrainingStatus::Stopped;
    }

    // validation の監視指標(タスクごとに monitoredMetric() が決める。例: Segmentation は mIoU)を監視し、
    // 更新されたエポックだけ重みを保存する。
    // 再開時は過去のベストを引き継ぐ。引き継がないと最初のエポックが必ず
    // 「初回 = 改善」と判定され、より悪いモデルで best を上書きしてしまう。
    // 指標の向き(Max / Min)は評価結果のタスク種別で決まるため、最初の評価後に構築する。
    std::optional<BestMetricTracker> bestTracker;

    if (resume.startEpoch > 0)
    {
        std::cout << "resume: epoch " << resume.startEpoch << " から再開";
        if (resume.hasInitialBest)
        {
            std::cout << " (best=" << resume.initialBest << " を引き継ぎ)";
        }
        std::cout << std::endl;
    }

    // 累計時間は今回の学習の開始から数える(checkpoint は経過時間を保存していないため、再開前の分は含まない)。
    const auto trainingStart = std::chrono::steady_clock::now();

    for (unsigned int epoch = resume.startEpoch; epoch < totalEpochs; ++epoch)
    {
        const auto epochStart = std::chrono::steady_clock::now();

        const EpochMetrics trainMetrics = _trainer->trainOneEpoch(*datasets.trainDataset);
        const EpochMetrics valMetrics = _evaluator->evaluate(*datasets.validationDataset);
        const MonitoredMetric monitored = monitoredMetric(valMetrics.taskMetrics);

        if (!bestTracker.has_value())
        {
            bestTracker = resume.hasInitialBest
                              ? BestMetricTracker(monitored.mode, resume.initialBest)
                              : BestMetricTracker(monitored.mode);
        }

        EpochReport report;
        report.epoch = epoch;
        report.trainLoss = trainMetrics.loss;
        report.validation = valMetrics;
        report.epochElapsedMs = elapsedMs(epochStart);
        report.totalElapsedMs = elapsedMs(trainingStart);
        _progressObserver->onEpochCompleted(report);

        if (bestTracker->update(monitored.value))
        {
            try
            {
                _checkpointStore->saveBest({epoch, bestTracker->best()});
                std::cout << "  -> best updated (val_" << monitored.name << "=" << bestTracker->best() << ")" << std::endl;
            }
            catch (const std::exception &e)
            {
                // 保存に失敗しても学習は継続する。
                std::cerr << "  -> checkpoint save failed: " << e.what() << std::endl;
            }
        }

        // 停止要求はエポックの区切りで確認する(エポックの途中では止めない)。
        const bool stopRequested = isStopRequested();

        // 中断・再開用の「直近」チェックポイント。best と違い指標に関係なく書く。
        // meta.epoch は「最後に完了したエポック」なので、再開側は epoch + 1 から始める。
        // 最終エポックと、停止要求で抜けるエポックは、頻度設定にかかわらず必ず保存する(末尾の進捗を捨てないため)。
        const unsigned int interval = _saveLastEvery == 0u ? 1u : _saveLastEvery;
        const bool isLastEpoch = (epoch + 1u == totalEpochs);
        if (((epoch + 1u) % interval == 0u) || isLastEpoch || stopRequested)
        {
            try
            {
                _checkpointStore->saveLast({epoch, bestTracker->best()});
            }
            catch (const std::exception &e)
            {
                std::cerr << "  -> last checkpoint save failed: " << e.what() << std::endl;
            }
        }

        // 最終エポックで停止要求が来た場合は、学習自体は最後まで終わっているので Completed とする。
        if (stopRequested && !isLastEpoch)
        {
            return TrainingStatus::Stopped;
        }
    }

    return TrainingStatus::Completed;
}
