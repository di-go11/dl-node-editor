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

namespace
{
    // 64bit の値をよく混ぜる(splitmix64)。近い入力(エポック 1 と 2 など)からも、かけ離れた値を作るために使う。
    uint64_t mix64(uint64_t x)
    {
        x += 0x9e3779b97f4a7c15ULL;
        x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ULL;
        x = (x ^ (x >> 27)) * 0x94d049bb133111ebULL;
        return x ^ (x >> 31);
    }
} // namespace

uint64_t SegmentationDatasetRepository::sampleSeed(uint64_t dataSeed, uint64_t resetCount, size_t sampleIndex)
{
    return mix64(mix64(mix64(dataSeed) ^ resetCount) ^ static_cast<uint64_t>(sampleIndex));
}

SegmentationDatasetRepository::SegmentationDatasetRepository(std::shared_ptr<ISegmentationData> source,
                                                             std::shared_ptr<IImagePreprocessor> imagePreProcessor,
                                                             std::shared_ptr<IImagePreprocessor> maskPreProcessor,
                                                             const std::shared_ptr<TrainParam> &trainParam,
                                                             std::shared_ptr<IParallelExecutor> parallelExecutor,
                                                             const bool shuffle,
                                                             std::shared_ptr<ISegmentationAugmenter> augmenter,
                                                             const uint64_t dataSeed)
    : _source(std::move(source)),
      _imagePreProcessor(std::move(imagePreProcessor)),
      _maskPreProcessor(std::move(maskPreProcessor)),
      _augmenter(std::move(augmenter)),
      _parallelExecutor(std::move(parallelExecutor)),
      _batchSize(trainParam->getBatchSize()),
      _currentIndex(0),
      _shuffle(shuffle),
      _dataSeed(dataSeed),
      _rng(dataSeed)
{
    _order.resize(_source->size());
    std::iota(_order.begin(), _order.end(), 0);
}

void SegmentationDatasetRepository::reset()
{
    _currentIndex = 0;
    ++_resetCount; // 拡張の乱数をエポックごとに変えるために数える
    if (_shuffle)
    {
        std::shuffle(_order.begin(), _order.end(), _rng); // 乱数_engから_begin()と_endの要素を入れ替える。
    }
}

bool SegmentationDatasetRepository::hasNext() const
{
    return _currentIndex < _source->size();
}

std::size_t SegmentationDatasetRepository::batchCount() const
{
    // getNextBatch() は _batchSize 件ずつ切り出し、最後の端数も 1 バッチとして返すので、切り上げの割り算になる。
    if (_batchSize == 0)
    {
        return 0;
    }
    const std::size_t batchSize = static_cast<std::size_t>(_batchSize);
    return (_source->size() + batchSize - 1) / batchSize;
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

                                       // 拡張(train のみ。validation は _augmenter が nullptr)。
                                       // 乱数は読み出し順やスレッドではなく、サンプル番号 i とエポックから決める。
                                       if (_augmenter)
                                       {
                                           _augmenter->apply(resizedImage, resizedMask, sampleSeed(_dataSeed, _resetCount, i));
                                       }

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