#pragma once
#include "training/application/interfaces/IDatasetRepository.hpp"

#include "training/application/interfaces/image/IImagePreprocessor.hpp"
#include "training/infrastructure/dataset/interfaces/ISegmentationData.hpp"

#include "training/entities/domain-objects/TrainParam.hpp"

#include "training/application/interfaces/parallelProcessFn/IParallelExecutor.hpp"

#include <memory>
#include <random>
#include <vector>

class SegmentationDatasetRepository : public IDatasetRepository
{
public:
    SegmentationDatasetRepository(std::shared_ptr<ISegmentationData> source,
                                  std::shared_ptr<IImagePreprocessor> imagePreProcessor,
                                  std::shared_ptr<IImagePreprocessor> maskPreProcessor,
                                  const std::shared_ptr<TrainParam> &trainParam,
                                  std::shared_ptr<IParallelExecutor> parallelExecutor,
                                  const bool shuffle,
                                  const uint64_t shuffleSeed);
    void reset() override;
    bool hasNext() const override;
    TrainingBatch getNextBatch() override;

private:
    std::shared_ptr<ISegmentationData> _source;
    std::shared_ptr<IImagePreprocessor> _imagePreProcessor, _maskPreProcessor;
    std::shared_ptr<IParallelExecutor> _parallelExecutor;
    unsigned int _batchSize;
    size_t _currentIndex = 0;
    std::vector<size_t> _order; // 呼び出す順番
    bool _shuffle;
    std::mt19937_64 _rng;
};