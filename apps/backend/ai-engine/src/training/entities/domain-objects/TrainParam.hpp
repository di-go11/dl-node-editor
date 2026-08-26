#pragma once

#include <memory>

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
