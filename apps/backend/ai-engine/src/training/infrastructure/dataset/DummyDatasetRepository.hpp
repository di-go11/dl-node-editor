#pragma once

#include "training/application/interfaces/IDatasetRepository.hpp"
#include "training/entities/domain-objects/TrainingBatch.hpp"

#include <cstddef>
#include <vector>

class DummyDatasetRepository : public IDatasetRepository
{
public:
    explicit DummyDatasetRepository(int batchCount = 2);

    BatchData *getBatchData() override;
    void reset() override;
    bool hasNext() const override;
    TrainingBatch getNextBatch() override;

private:
    static BatchData makeDummyBatchData(const std::vector<size_t> &shape);

    int _batchCount;
    int _currentBatch;
};
