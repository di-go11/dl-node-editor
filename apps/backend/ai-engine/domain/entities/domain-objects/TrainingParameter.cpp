#include "./TrainingParameter.hpp"

TrainingParameter::TrainingParameter(std::shared_ptr<IModelConfig> modelconfig, std::shared_ptr<ILossFnConfig> lossfnconfig, unsigned int epochsize, unsigned int batchsize, double learningrate)
    : _modelConfig(modelconfig), _lossFnConfig(lossfnconfig), _epochSize(epochsize), _batchSize(batchsize), _learningRate(learningrate) {}

double TrainingParameter::getLr() const
{
    return _learningRate;
}

unsigned int TrainingParameter::getEpochSize() const
{
    return _epochSize;
}

unsigned int TrainingParameter::getBatchSize() const
{
    return _batchSize;
}

std::shared_ptr<IModelConfig> TrainingParameter::getModelConfig() const
{
    return _modelConfig;
}

std::shared_ptr<ILossFnConfig> TrainingParameter::getLossFnConfig() const
{
    return _lossFnConfig;
}