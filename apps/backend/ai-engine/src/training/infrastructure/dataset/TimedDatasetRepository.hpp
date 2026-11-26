#pragma once

#include "training/application/interfaces/ITimeRecorder.hpp"
#include "training/application/interfaces/IDatasetRepository.hpp"
#include "training/entities/domain-objects/TrainingBatch.hpp"
#include "training/entities/domain-objects/ProcessTimeSpan.hpp"

#include <memory>
#include <string>

class TimedDatasetRepository : public IDatasetRepository
{
public:
    TimedDatasetRepository(std::shared_ptr<IDatasetRepository> datasetRepository, std::shared_ptr<ITimeRecorder> timeRecorder, const std::string &name);

    void reset() override;
    bool hasNext() const override;
    TrainingBatch getNextBatch() override;
    // 計算するだけの軽い処理なので計測はせず、中のリポジトリの値をそのまま返す。
    std::size_t batchCount() const override { return _datasetRepository->batchCount(); }

private:
    // 区間の名前は、呼び出しのたびに文字列を組み立てないよう、コンストラクタで1回だけ作る。
    std::string _hasNextName;
    std::string _getNextBatchName;

    std::shared_ptr<IDatasetRepository> _datasetRepository;
    std::shared_ptr<ITimeRecorder> _timeRecorder;
};
