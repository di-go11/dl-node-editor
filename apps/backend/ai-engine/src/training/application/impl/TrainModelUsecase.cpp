#include "./TrainModelUsecase.hpp"

#include "../../entities/domain-objects/TrainParam.hpp"
#include "../../entities/domain-objects/EpochMetrics.hpp"
#include "../interfaces/IModelTrainer.hpp"
#include "training/application/interfaces/IModelEvaluator.hpp"
#include "training/application/impl/TrainingDatasets.hpp"

#include <iostream>

TrainModelUsecase::TrainModelUsecase(const std::shared_ptr<TrainParam> &param,
                                     const AppConfig &appConfig,
                                     const std::shared_ptr<IModelTrainer> &trainer,
                                     const std::shared_ptr<IModelEvaluator> &evaluator)
    : _param(param),
      _appConfig(appConfig),
      _trainer(trainer),
      _evaluator(evaluator) {}

void TrainModelUsecase::execute(const TrainingDatasets &datasets)
{
    for (unsigned int epoch = 0; epoch < _param->getEpochSize(); ++epoch)
    {
        // train / validation はどちらも「データセット1周」の粒度で対称。
        // バッチ分割・reset・テンソル変換は trainer / evaluator の内部責務。
        const EpochMetrics trainMetrics = _trainer->trainOneEpoch(*datasets.trainDataset);
        const EpochMetrics valMetrics = _evaluator->evaluate(*datasets.validationDataset);

        std::cout << "epoch " << epoch
                  << " | train_loss=" << trainMetrics.loss
                  << " | val_loss=" << valMetrics.loss
                  << " | val_pixel_acc=" << valMetrics.pixelAccuracy
                  << " | val_mIoU=" << valMetrics.meanIoU
                  << std::endl;
    }
}
