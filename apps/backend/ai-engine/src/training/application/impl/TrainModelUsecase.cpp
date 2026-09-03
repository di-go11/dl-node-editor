#include "./TrainModelUsecase.hpp"

#include "../../entities/domain-objects/TrainParam.hpp"
#include "../../entities/domain-objects/EpochMetrics.hpp"
#include "training/application/impl/TrainingDatasets.hpp"
#include "training/application/impl/BestMetricTracker.hpp"
#include "../interfaces/IModelTrainer.hpp"
#include "training/application/interfaces/IModelEvaluator.hpp"
#include "training/application/interfaces/ICheckpointStore.hpp"

#include <exception>
#include <iostream>

TrainModelUsecase::TrainModelUsecase(const std::shared_ptr<TrainParam> &param,
                                     const AppConfig &appConfig,
                                     const std::shared_ptr<IModelTrainer> &trainer,
                                     const std::shared_ptr<IModelEvaluator> &evaluator,
                                     const std::shared_ptr<ICheckpointStore> &checkpointStore)
    : _param(param),
      _appConfig(appConfig),
      _trainer(trainer),
      _evaluator(evaluator),
      _checkpointStore(checkpointStore) {}

void TrainModelUsecase::execute(const TrainingDatasets &datasets)
{
    // validation mIoU(大きいほど良い)を監視し、更新されたエポックだけ重みを保存する。
    BestMetricTracker bestMiou(MetricMode::Max);

    for (unsigned int epoch = 0; epoch < _param->getEpochSize(); ++epoch)
    {
        const EpochMetrics trainMetrics = _trainer->trainOneEpoch(*datasets.trainDataset);
        const EpochMetrics valMetrics = _evaluator->evaluate(*datasets.validationDataset);

        std::cout << "epoch " << epoch
                  << " | train_loss=" << trainMetrics.loss
                  << " | val_loss=" << valMetrics.loss
                  << " | val_pixel_acc=" << valMetrics.pixelAccuracy
                  << " | val_mIoU=" << valMetrics.meanIoU
                  << std::endl;

        if (bestMiou.update(valMetrics.meanIoU))
        {
            try
            {
                _checkpointStore->saveBest(epoch);
                std::cout << "  -> best updated (val_mIoU=" << bestMiou.best() << ")" << std::endl;
            }
            catch (const std::exception &e)
            {
                // 保存に失敗しても学習は継続する。
                std::cerr << "  -> checkpoint save failed: " << e.what() << std::endl;
            }
        }
    }
}
