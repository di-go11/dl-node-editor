#include "SegmentationDatasetRepository.hpp"

#include "training/entities/domain-objects/BatchData.hpp"
#include "training/entities/domain-objects/TrainingBatch.hpp"
#include "training/entities/domain-objects/TrainParam.hpp"
#include "training/entities/image/ImageData.hpp"

#include "training/application/impl/image/ImageNormalizer.hpp"

#include <algorithm>
#include <memory>
#include <utility>
#include <optional>
#include <numeric>

SegmentationDatasetRepository::SegmentationDatasetRepository(std::shared_ptr<ISegmentationData> source,
                                                             std::shared_ptr<IImagePreprocessor> imagePreProcessor,
                                                             std::shared_ptr<IImagePreprocessor> maskPreProcessor,
                                                             const std::shared_ptr<TrainParam> &trainParam,
                                                             std::shared_ptr<IParallelExecutor> parallelExecutor,
                                                             const bool shuffle,
                                                             const uint64_t shuffleSeed)
    : _source(std::move(source)),
      _imagePreProcessor(std::move(imagePreProcessor)),
      _maskPreProcessor(std::move(maskPreProcessor)),
      _batchSize(trainParam->getBatchSize()),
      _parallelExecutor(std::move(parallelExecutor)),
      _currentIndex(0),
      _shuffle(shuffle),
      _rng(shuffleSeed)
{
    _order.resize(_source->size());
    std::iota(_order.begin(), _order.end(), 0);
}

void SegmentationDatasetRepository::reset()
{
    _currentIndex = 0;
    if (_shuffle)
    {
        std::shuffle(_order.begin(), _order.end(), _rng); // 乱数_engから_begin()と_endの要素を入れ替える。
    }
}

bool SegmentationDatasetRepository::hasNext() const
{
    return _currentIndex < _source->size();
}

TrainingBatch SegmentationDatasetRepository::getNextBatch()
{
    const size_t start = _currentIndex;
    const size_t end = std::min(_currentIndex + static_cast<size_t>(_batchSize), _source->size());
    const size_t count = end - start; // バッチごとのサンプル数。

    std::vector<NormalizedImageData> inputs(count);
    std::vector<std::optional<ImageData>> targets(count);

    // executer機能のテスト(スレッド数1での逐次処理)
    _parallelExecutor->parallelFor(count, [&](size_t index)
                                   {
                                       const size_t i = _order[start + index];
                                       ImageData image = _source->getImage(i);
                                       ImageData mask = _source->getMask(i);

                                       // uint8のImageDataに対して、リサイズと正規化を行う。入力画像は正規化するが、マスクは正規化しない。
                                       ImageData resizedImage = _imagePreProcessor->process(image);
                                       ImageData resizedMask = _maskPreProcessor->process(mask);

                                       inputs[index] = ImageNormalizer::normalize(resizedImage); // 各スレッドごとに、正規化済みの入力画像を格納する。
                                       targets[index].emplace(std::move(resizedMask));           // 各スレッドごとに、正規化していないマスクを格納する。
                                   });
    TrainingBatch batch;
    batch.input.values = std::move(inputs);
    batch.target.values.reserve(count);
    for (auto &t : targets)
    {
        batch.target.values.push_back(std::move(*t)); // std::optionalからImageDataを取り出して、正規化していないマスクを格納する。
    }

    _currentIndex = end;

    return batch;
}