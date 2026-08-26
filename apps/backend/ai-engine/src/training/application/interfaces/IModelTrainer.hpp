#pragma once

class BatchData;
class TrainParam;

class IModelTrainer
{
public:
    virtual ~IModelTrainer() = default;
    virtual void train(BatchData &inputBatchData, BatchData &targetBatchData, TrainParam &trainParam) = 0;
};