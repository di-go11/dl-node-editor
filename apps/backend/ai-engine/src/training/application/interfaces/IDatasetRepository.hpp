#pragma once

struct TrainingBatch;

class IDatasetRepository
{
public:
    virtual ~IDatasetRepository() = default;
    virtual void reset() = 0;
    virtual bool hasNext() const = 0;
    virtual TrainingBatch getNextBatch() = 0;
};