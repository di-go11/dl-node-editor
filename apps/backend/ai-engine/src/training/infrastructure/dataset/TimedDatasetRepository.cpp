#include "TimedDatasetRepository.hpp"

#include "training/application/impl/ScopedTimer.hpp"

// IDatasetRepository を包み、hasNext / getNextBatch の所要時間を ITimeRecorder に記録する Decorator。
// 呼び出しは内側にそのまま委譲する(回数も戻り値も変えない)。
TimedDatasetRepository::TimedDatasetRepository(std::shared_ptr<IDatasetRepository> datasetRepository, std::shared_ptr<ITimeRecorder> timeRecorder, const std::string &name)
    : _hasNextName(name + "_hasNext"),
      _getNextBatchName(name + "_getNextBatch"),
      _datasetRepository(datasetRepository),
      _timeRecorder(timeRecorder)
{
}

void TimedDatasetRepository::reset()
{
    _datasetRepository->reset();
}

bool TimedDatasetRepository::hasNext() const
{
    ScopedTimer timer(*_timeRecorder, _hasNextName); // 関数を抜けるときに、区間が記録される
    return _datasetRepository->hasNext();
}

TrainingBatch TimedDatasetRepository::getNextBatch()
{
    ScopedTimer timer(*_timeRecorder, _getNextBatchName);
    return _datasetRepository->getNextBatch();
}
