#pragma once
#include "training/application/interfaces/IDatasetRepository.hpp"

#include "training/application/interfaces/image/IImagePreprocessor.hpp"
#include "training/application/interfaces/image/ISegmentationAugmenter.hpp"
#include "training/infrastructure/dataset/interfaces/ISegmentationData.hpp"

#include "training/entities/domain-objects/TrainParam.hpp"

#include "training/application/interfaces/parallelProcessFn/IParallelExecutor.hpp"

#include <cstdint>
#include <memory>
#include <random>
#include <vector>

class SegmentationDatasetRepository : public IDatasetRepository
{
public:
    // shuffle: true なら reset() のたびに読み出す順番を並べ替える(train 用)。
    // augmenter: データ拡張。nullptr なら拡張しない(validation 用)。
    // dataSeed: シャッフル順と拡張の乱数の基準。同じ値なら同じ順番・同じ拡張になる。
    SegmentationDatasetRepository(std::shared_ptr<ISegmentationData> source,
                                  std::shared_ptr<IImagePreprocessor> imagePreProcessor,
                                  std::shared_ptr<IImagePreprocessor> maskPreProcessor,
                                  const std::shared_ptr<TrainParam> &trainParam,
                                  std::shared_ptr<IParallelExecutor> parallelExecutor,
                                  const bool shuffle,
                                  std::shared_ptr<ISegmentationAugmenter> augmenter,
                                  const uint64_t dataSeed);
    void reset() override;
    bool hasNext() const override;
    TrainingBatch getNextBatch() override;
    std::size_t batchCount() const override;

    // 拡張に渡す乱数の seed。基準 seed・reset の回数・サンプル番号(読み出し順ではなくデータセット内の番号)だけで決まるので、
    // スレッド数やシャッフル順に関係なく、同じ dataSeed なら同じ値になる。
    static uint64_t sampleSeed(uint64_t dataSeed, uint64_t resetCount, size_t sampleIndex);

private:
    std::shared_ptr<ISegmentationData> _source;
    std::shared_ptr<IImagePreprocessor> _imagePreProcessor, _maskPreProcessor;
    std::shared_ptr<ISegmentationAugmenter> _augmenter; // nullptr なら拡張しない
    std::shared_ptr<IParallelExecutor> _parallelExecutor;
    unsigned int _batchSize;
    size_t _currentIndex = 0;
    std::vector<size_t> _order; // 呼び出す順番
    bool _shuffle;
    uint64_t _dataSeed;
    uint64_t _resetCount = 0; // reset() を呼んだ回数(= 何エポック目か)。拡張の乱数に使う
    std::mt19937_64 _rng;     // シャッフル用
};
