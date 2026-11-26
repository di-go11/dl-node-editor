#pragma once

#include <cstddef>

struct TrainingBatch;

class IDatasetRepository
{
public:
    virtual ~IDatasetRepository() = default;
    virtual void reset() = 0;
    virtual bool hasNext() const = 0;
    virtual TrainingBatch getNextBatch() = 0;
    virtual std::size_t batchCount() const = 0;
};