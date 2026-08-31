#pragma once

#include "training/application/interfaces/IDatasetRepository.hpp"
#include "training/entities/domain-objects/TrainingBatch.hpp"
#include "training/entities/domain-objects/BatchData.hpp"
#include "training/entities/image/ImageData.hpp"
#include "training/entities/image/NormalizedImageData.hpp"

#include <cstddef>
#include <vector>

class DummyDatasetRepository : public IDatasetRepository
{
public:
    explicit DummyDatasetRepository(int batchCount = 2);

    void reset() override;
    bool hasNext() const override;
    TrainingBatch getNextBatch() override;

private:
    // input 用: 0.5 で埋めた正規化済みダミー。
    static BatchData<NormalizedImageData> makeNormalizedBatch(const std::vector<size_t> &shape);
    // target 用: 128 で埋めた生値ダミー。
    static BatchData<ImageData> makeImageBatch(const std::vector<size_t> &shape);

    int _batchCount;
    int _currentBatch;
};
