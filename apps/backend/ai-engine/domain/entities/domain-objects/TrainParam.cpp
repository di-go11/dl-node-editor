#include "./TrainParam.hpp"

TrainParam::TrainParam(std::shared_ptr<IModelConfig> modelconfig, std::shared_ptr<ILossFnConfig> lossfnconfig, unsigned int epochsize, unsigned int batchsize, double learningrate)
    : _modelConfig(modelconfig), _lossFnConfig(lossfnconfig), _epochSize(epochsize), _batchSize(batchsize), _learningRate(learningrate) {}

double TrainParam::getLr() const
{
    return _learningRate;
}

unsigned int TrainParam::getEpochSize() const
{
    return _epochSize;
}

unsigned int TrainParam::getBatchSize() const
{
    return _batchSize;
}

std::shared_ptr<IModelConfig> TrainParam::getModelConfig() const
{
    return _modelConfig;
}

std::shared_ptr<ILossFnConfig> TrainParam::getLossFnConfig() const
{
    return _lossFnConfig;
}