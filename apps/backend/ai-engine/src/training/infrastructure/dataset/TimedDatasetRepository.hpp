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

private:
    std::string _name;

    std::shared_ptr<IDatasetRepository> _datasetRepository;
    std::shared_ptr<ITimeRecorder> _timeRecorder;
};
