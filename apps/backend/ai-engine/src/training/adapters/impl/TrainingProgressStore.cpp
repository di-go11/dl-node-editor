#include "TrainingProgressStore.hpp"

void TrainingProgressStore::start()
{
    {
        std::lock_guard<std::mutex> lock(_mutex);
        // 前のジョブの読み手が「新しい更新」と気づけるよう、version だけは引き継いで進める。
        const uint64_t nextVersion = _snapshot.version + 1;
        _snapshot = TrainingProcessSnapshot{};
        _snapshot.status = TrainingStatus::Running;
        _snapshot.version = nextVersion;
        _epochReports.clear();
    }
    _cv.notify_all();
}

void TrainingProgressStore::onEpochCompleted(const EpochReport &report)
{
    {
        std::lock_guard<std::mutex> lock(_mutex);
        _snapshot.latest = report;
        _snapshot.hasEpochReport = true;
        _epochReports.push_back(report);
        ++_snapshot.version;
    }
    _cv.notify_all();
}

void TrainingProgressStore::onFinished(TrainingStatus status, const std::string &errorMessage)
{
    {
        std::lock_guard<std::mutex> lock(_mutex);
        _snapshot.status = status;
        _snapshot.errorMessage = errorMessage;
        ++_snapshot.version;
    }
    _cv.notify_all();
}

TrainingProcessSnapshot TrainingProgressStore::getTrainingProcessSnapshot()
{
    std::lock_guard<std::mutex> lock(_mutex);
    return _snapshot;
}

TrainingProcessSnapshot TrainingProgressStore::waitForUpdate(uint64_t lastVersion, std::chrono::milliseconds timeout)
{
    std::unique_lock<std::mutex> lock(_mutex);
    // 述語付きの wait_for は、spurious wakeup(通知がないのに起きること)でも条件を確かめ直す。
    _cv.wait_for(lock, timeout, [&]
                 { return _snapshot.version > lastVersion; });
    return _snapshot;
}

EpochBatch TrainingProgressStore::waitForEpochsAfter(unsigned int afterEpoch, uint64_t lastVersion, std::chrono::milliseconds timeout)
{
    std::unique_lock<std::mutex> lock(_mutex);
    _cv.wait_for(lock, timeout, [&]
                 { return _snapshot.version > lastVersion; });

    EpochBatch batch;
    for (const EpochReport &report : _epochReports)
    {
        if (report.epoch + 1u > afterEpoch)
        {
            batch.reports.push_back(report);
        }
    }
    batch.status = _snapshot.status;
    batch.errorMessage = _snapshot.errorMessage;
    batch.version = _snapshot.version;
    return batch;
}