#include "training/infrastructure/dataset/DummyDatasetRepository.hpp"

#include "training/entities/domain-objects/BatchData.hpp"
#include "training/entities/image/ImageData.hpp"
#include "training/entities/image/NormalizedImageData.hpp"

#include <cstdint>
#include <utility>
#include <vector>

DummyDatasetRepository::DummyDatasetRepository(int batchCount)
    : _batchCount(batchCount), _currentBatch(0)
{
}

void DummyDatasetRepository::reset()
{
    _currentBatch = 0;
}

bool DummyDatasetRepository::hasNext() const
{
    return _currentBatch < _batchCount;
}

namespace
{
    size_t product(const std::vector<size_t> &shape)
    {
        size_t valueCount = 1;
        for (auto dimension : shape)
        {
            valueCount *= dimension;
        }
        return valueCount;
    }
} // namespace

BatchData<NormalizedImageData> DummyDatasetRepository::makeNormalizedBatch(const std::vector<size_t> &shape)
{
    NormalizedImageData image;
    image.shape = shape;
    image.values.assign(product(shape), 0.5f); // ダミー値(正規化後の中間グレー相当)

    BatchData<NormalizedImageData> batch;
    batch.values.push_back(std::move(image));
    batch.num_samples = static_cast<int>(batch.values.size());
    return batch;
}

BatchData<ImageData> DummyDatasetRepository::makeImageBatch(const std::vector<size_t> &shape)
{
    ImageData image(shape, std::vector<uint8_t>(product(shape), static_cast<uint8_t>(128)));

    BatchData<ImageData> batch;
    batch.values.push_back(std::move(image));
    batch.num_samples = static_cast<int>(batch.values.size());
    return batch;
}

TrainingBatch DummyDatasetRepository::getNextBatch()
{
    TrainingBatch batch;
    batch.input = makeNormalizedBatch({1, 256, 256}); // Conv2D inChannels=1に対応
    batch.target = makeImageBatch({4, 256, 256});     // Conv2D outChannels=4に対応
    ++_currentBatch;
    return batch;
}
