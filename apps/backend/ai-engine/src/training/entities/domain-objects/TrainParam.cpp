#include "./TrainParam.hpp"
#include <stdexcept>

TrainParam::TrainParam(unsigned int epochsize, unsigned int batchsize)
    : _epochSize(epochsize), _batchSize(batchsize)
{
    if (_epochSize == 0)
    {
        throw std::invalid_argument("Epoch size must be greater than 0");
    }
    if (_batchSize == 0)
    {
        throw std::invalid_argument("Batch size must be greater than 0");
    }
}

unsigned int TrainParam::getEpochSize() const
{
    return _epochSize;
}

unsigned int TrainParam::getBatchSize() const
{
    return _batchSize;
}