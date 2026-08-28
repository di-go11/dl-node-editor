#include "./TrainModelUsecase.hpp"
#include "../../entities/domain-objects/TrainParam.hpp"
#include "../interfaces/IDatasetRepository.hpp"
#include "../interfaces/IModelTrainer.hpp"
#include "../../entities/domain-objects/BatchData.hpp"
#include "training/entities/domain-objects/TrainingBatch.hpp"

#include <memory>
#include <vector>

TrainModelUsecase::TrainModelUsecase(const std::shared_ptr<TrainParam> &param,
                                     const AppConfig &appConfig,
                                     const std::shared_ptr<IModelTrainer> &trainer)
    : _param(param),
      _appConfig(appConfig),
      _trainer(trainer) {}

void TrainModelUsecase::execute(IDatasetRepository *dataset)
{
    // Here you can implement the logic to execute the training process
    // using the provided dataset, training parameters, and model trainer.
    // For example:
    // 1. Load the dataset using the dataset repository.
    // 2. Configure the model using the training parameters.
    // 3. Start the training process using the model trainer.
    for (int epoch = 0; epoch < _param->getEpochSize(); ++epoch)
    {
        dataset->reset();
        while (dataset->hasNext())
        {
            TrainingBatch batch = dataset->getNextBatch();
            _trainer->train(batch.input, batch.target, *_param);
        }
    }
}
