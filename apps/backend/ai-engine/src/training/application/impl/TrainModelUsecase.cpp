#include "./TrainModelUsecase.hpp"

#include "../../entities/domain-objects/TrainParam.hpp"
#include "../../entities/domain-objects/Metrics/EpochMetrics.hpp"
#include "../../entities/domain-objects/Metrics/MonitoredMetric.hpp"
#include "training/application/impl/TrainingDatasets.hpp"
#include "training/application/impl/BestMetricTracker.hpp"
#include "../interfaces/IModelTrainer.hpp"
#include "training/application/interfaces/IModelEvaluator.hpp"
#include "training/application/interfaces/ICheckpointStore.hpp"

#include <exception>
#include <iostream>
#include <optional>

TrainModelUsecase::TrainModelUsecase(const std::shared_ptr<TrainParam> &param,
                                     unsigned int saveLastEvery,
                                     const std::shared_ptr<IModelTrainer> &trainer,
                                     const std::shared_ptr<IModelEvaluator> &evaluator,
                                     const std::shared_ptr<ICheckpointStore> &checkpointStore)
    : _param(param),
      _saveLastEvery(saveLastEvery),
      _trainer(trainer),
      _evaluator(evaluator),
      _checkpointStore(checkpointStore) {}

void TrainModelUsecase::execute(const TrainingDatasets &datasets, const TrainingResumeState &resume)
{
    const unsigned int totalEpochs = _param->getEpochSize();

    if (resume.startEpoch >= totalEpochs)
    {
        // 保存済みの進捗が設定された総エポック数に既に達している。
        // 黙って 0 エポック回すと「学習した」と誤解されるため明示的に知らせる。
        std::cout << "resume: startEpoch=" << resume.startEpoch
                  << " が総エポック数 " << totalEpochs
                  << " 以上のため、実行するエポックがありません。" << std::endl;
        return;
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

    for (unsigned int epoch = resume.startEpoch; epoch < totalEpochs; ++epoch)
    {
        const EpochMetrics trainMetrics = _trainer->trainOneEpoch(*datasets.trainDataset);
        const EpochMetrics valMetrics = _evaluator->evaluate(*datasets.validationDataset);
        const MonitoredMetric monitored = monitoredMetric(valMetrics.taskMetrics);

        if (!bestTracker.has_value())
        {
            bestTracker = resume.hasInitialBest
                              ? BestMetricTracker(monitored.mode, resume.initialBest)
                              : BestMetricTracker(monitored.mode);
        }

        std::cout << "epoch " << epoch
                  << " | train_loss=" << trainMetrics.loss
                  << " | val_loss=" << valMetrics.loss
                  << " | val " << describe(valMetrics.taskMetrics)
                  << std::endl;

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

        // 中断・再開用の「直近」チェックポイント。best と違い指標に関係なく書く。
        // meta.epoch は「最後に完了したエポック」なので、再開側は epoch + 1 から始める。
        // 最終エポックは頻度設定にかかわらず必ず保存する(末尾の進捗を捨てないため)。
        const unsigned int interval = _saveLastEvery == 0u ? 1u : _saveLastEvery;
        const bool isLastEpoch = (epoch + 1u == totalEpochs);
        if (((epoch + 1u) % interval == 0u) || isLastEpoch)
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
    }
}
