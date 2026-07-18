#include "./TrainModelUsecase.hpp"

TrainModelUsecase::TrainModelUsecase(std::shared_ptr<TrainParam> param, std::shared_ptr<IPathProvidor> path, std::shared_ptr<IModelTrainer> trainer)
    : _param(param), _path(path), _trainer(trainer) {}

TrainModelUsecase::~TrainModelUsecase() = default;

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
        // Load dataset
        for (int batch = 0; batch < _param->getBatchSize(); ++batch)
        {
            // Get the data for the current batch
            std::vector<std::vector<float>> data = dataset->getArray();

            _trainer->train();
        }
    }
}