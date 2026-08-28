#include "training/infrastructure/dataset/DummyDatasetRepository.hpp"

#include "training/entities/domain-objects/BatchData.hpp"
#include "training/entities/image/ImageData.hpp"

DummyDatasetRepository::DummyDatasetRepository(int batchCount)
    : _batchCount(batchCount), _currentBatch(0)
{
}

BatchData *DummyDatasetRepository::getBatchData()
{
    return nullptr; // TrainModelUsecase::execute()では未使用のため疎通確認上は空実装で問題ない
}

void DummyDatasetRepository::reset()
{
    _currentBatch = 0;
}

bool DummyDatasetRepository::hasNext() const
{
    return _currentBatch < _batchCount;
}

BatchData DummyDatasetRepository::makeDummyBatchData(const std::vector<size_t> &shape)
{
    size_t valueCount = 1;
    for (auto dimension : shape)
    {
        valueCount *= dimension;
    }

    ImageData image;
    image.shape = shape;
    image.values.assign(valueCount, static_cast<uint8_t>(128)); // ダミー値(中間のグレー相当)

    BatchData batch;
    batch.values.push_back(image);
    batch.num_samples = static_cast<int>(batch.values.size());
    return batch;
}

TrainingBatch DummyDatasetRepository::getNextBatch()
{
    TrainingBatch batch;
    batch.input = makeDummyBatchData({1, 256, 256});  // Conv2D inChannels=1に対応
    batch.target = makeDummyBatchData({4, 256, 256}); // Conv2D outChannels=4に対応
    ++_currentBatch;
    return batch;
}
