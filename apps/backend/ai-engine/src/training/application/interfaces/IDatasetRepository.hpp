#pragma once

class BatchData;
struct TrainigBatch;

class IDatasetRepository
{
public:
    virtual ~IDatasetRepository() = default;
    virtual BatchData *getBatchData() = 0;
    virtual void reset() = 0;
    virtual bool hasNext() const = 0;
    virtual TrainingBatch getNextBatch() = 0;
};