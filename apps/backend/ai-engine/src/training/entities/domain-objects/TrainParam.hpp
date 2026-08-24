#pragma once

#include <memory>

#include "../interfaces/IModelConfig.hpp"
#include "../interfaces/ILossFnConfig.hpp"

class TrainParam
{
private:
    unsigned int _epochSize;
    unsigned int _batchSize;

public:
    TrainParam(unsigned int epochsize, unsigned int batchsize);
    ~TrainParam() = default;

    unsigned int getEpochSize() const;
    unsigned int getBatchSize() const;
};
