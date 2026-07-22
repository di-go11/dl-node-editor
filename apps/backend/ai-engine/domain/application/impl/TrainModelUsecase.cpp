#include "./TrainModelUsecase.hpp"
#include "../../entities/domain-objects/TrainParam.hpp"
#include "../interfaces/IDatasetRepository.hpp"
#include "../interfaces/IModelTrainer.hpp"
#include "../interfaces/IPathProvidor.hpp"
#include "../../entities/domain-objects/BatchData.hpp"
#include "../../entities/domain-objects/DatasetSize.hpp"

#include <memory>
#include <vector>

TrainModelUsecase::TrainModelUsecase(const std::shared_ptr<TrainParam> &param,
                                     const std::shared_ptr<IPathProvidor> &path,
                                     const std::shared_ptr<IModelTrainer> &trainer,
                                     const std::shared_ptr<DatasetSize> &datasetSize)
    : _param(param),
      _path(path),
      _trainer(trainer),
      _datasetSize(datasetSize) {}

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
        BatchData *batchData = dataset->getBatchData();
        // Load dataset
        for (int offset = 0; offset < dataset->getDatasetSize()->num_samples; offset += _param->getBatchSize())
        {
            // Get the data for the current batch
            _trainer->train(batchData);
        }
    }
}