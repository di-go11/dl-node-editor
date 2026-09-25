#include "SegmentationDatasetRepository.hpp"

#include "training/entities/domain-objects/BatchData.hpp"
#include "training/entities/domain-objects/TrainingBatch.hpp"
#include "training/entities/domain-objects/TrainParam.hpp"
#include "training/entities/image/ImageData.hpp"

#include "training/application/impl/image/ImageNormalizer.hpp"

#include <algorithm>
#include <memory>
#include <utility>

SegmentationDatasetRepository::SegmentationDatasetRepository(std::shared_ptr<ISegmentationData> source,
                                                             std::shared_ptr<IImagePreprocessor> imagePreProcessor,
                                                             std::shared_ptr<IImagePreprocessor> maskPreProcessor,
                                                             const std::shared_ptr<TrainParam> &trainParam)
    : _source(source),
      _imagePreProcessor(imagePreProcessor),
      _maskPreProcessor(maskPreProcessor),
      _batchSize(trainParam->getBatchSize()),
      _currentIndex(0)
{
}

void SegmentationDatasetRepository::reset()
{
    _currentIndex = 0;
}

bool SegmentationDatasetRepository::hasNext() const
{
    return _currentIndex < _source->size();
}

TrainingBatch SegmentationDatasetRepository::getNextBatch()
{
    TrainingBatch batch;

    const size_t end = std::min(_currentIndex + static_cast<size_t>(_batchSize), _source->size());

    for (size_t i = _currentIndex; i < end; ++i)
    {
        ImageData image = _source->getImage(i);
        ImageData mask = _source->getMask(i);

        // uint8のImageDataに対して、リサイズと正規化を行う。入力画像は正規化するが、マスクは正規化しない。
        ImageData resizedImage = _imagePreProcessor->process(image);
        ImageData resizedMask = _maskPreProcessor->process(mask);

        batch.input.values.push_back(ImageNormalizer::normalize(resizedImage)); // → NormalizedImageDatas
        batch.target.values.push_back(std::move(resizedMask));                  // ImageData のまま
    }

    batch.input.num_samples = static_cast<int>(batch.input.values.size());
    batch.target.num_samples = static_cast<int>(batch.target.values.size());

    _currentIndex = end;

    return batch;
}