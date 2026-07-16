#include "./TrainParam.hpp"
#include <stdexcept>

TrainParam::TrainParam(std::shared_ptr<IModelConfig> modelconfig, std::shared_ptr<ILossFnConfig> lossfnconfig, unsigned int epochsize, unsigned int batchsize, double learningrate)
    : _modelConfig(modelconfig), _lossFnConfig(lossfnconfig), _epochSize(epochsize), _batchSize(batchsize), _learningRate(learningrate) {}

double TrainParam::getLr() const
{
    if(_learningRate <= 0.0f || _learningRate > 1.0f) {
        throw std::invalid_argument("Learning rate must be in the range (0, 1]");
    }
    return _learningRate;
}

unsigned int TrainParam::getEpochSize() const
{
    if(_epochSize == 0) {
        throw std::invalid_argument("Epoch size must be greater than 0");
    }
    return _epochSize;
}

unsigned int TrainParam::getBatchSize() const
{
    if(_batchSize == 0) {
        throw std::invalid_argument("Batch size must be greater than 0");
    }
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