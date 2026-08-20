#include "./TrainParam.hpp"
#include <stdexcept>

TrainParam::TrainParam(unsigned int epochsize, unsigned int batchsize)
    : _epochSize(epochsize), _batchSize(batchsize) {}

unsigned int TrainParam::getEpochSize() const
{
    if (_epochSize == 0)
    {
        throw std::invalid_argument("Epoch size must be greater than 0");
    }
    return _epochSize;
}

unsigned int TrainParam::getBatchSize() const
{
    if (_batchSize == 0)
    {
        throw std::invalid_argument("Batch size must be greater than 0");
    }
    return _batchSize;
}