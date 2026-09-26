#include "TimedDatasetRepository.hpp"

#include <chrono>
#include <thread>

TimedDatasetRepository::TimedDatasetRepository(std::shared_ptr<IDatasetRepository> datasetRepository, std::shared_ptr<ITimeRecorder> timeRecorder, const std::string &name)
    : _name(name), _datasetRepository(datasetRepository), _timeRecorder(timeRecorder)
{
}

void TimedDatasetRepository::reset()
{
    _datasetRepository->reset();
}

bool TimedDatasetRepository::hasNext() const
{
    std::string spanName = _name + "_hasNext"; // スレッドIDも入れるが必要かどうかはのちのち検討

    auto startTime = std::chrono::steady_clock::now();
    bool result = _datasetRepository->hasNext();
    auto endTime = std::chrono::steady_clock::now();

    ProcessTimeSpan timeSpan;
    timeSpan.startTime = startTime;
    timeSpan.endTime = endTime;
    timeSpan.name = spanName;
    timeSpan.threadId = std::this_thread::get_id();

    _timeRecorder->record(timeSpan);

    return result;
}

TrainingBatch TimedDatasetRepository::getNextBatch()
{
    std::string spanName = _name + "_getNextBatch"; // スレッドIDも入れるが必要かどうかはのちのち検討

    auto startTime = std::chrono::steady_clock::now();
    TrainingBatch batch = _datasetRepository->getNextBatch();
    auto endTime = std::chrono::steady_clock::now();

    ProcessTimeSpan timeSpan;
    timeSpan.startTime = startTime;
    timeSpan.endTime = endTime;
    timeSpan.name = spanName;
    timeSpan.threadId = std::this_thread::get_id();

    _timeRecorder->record(timeSpan);

    return batch;
}