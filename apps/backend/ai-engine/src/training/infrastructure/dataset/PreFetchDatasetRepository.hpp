#pragma once

#include "training/application/interfaces/IDatasetRepository.hpp"
#include "training/entities/domain-objects/TrainingBatch.hpp"

#include <condition_variable>
#include <mutex>
#include <memory>

class PreFetchDatasetRepository : public IDatasetRepository // Decoratorパターン
{
public:
    explicit PreFetchDatasetRepository(std::shared_ptr<IDatasetRepository> datasetRepository);

    void reset() override;
    bool hasNext() const override;
    TrainingBatch getNextBatch() override;

private:
    mutable std::mutex _mutex; // メンバ関数が、非constなため、mutableを付与
    mutable std::condition_variable _consumerCv;

    std::shared_ptr<IDatasetRepository> _datasetRepository;
};