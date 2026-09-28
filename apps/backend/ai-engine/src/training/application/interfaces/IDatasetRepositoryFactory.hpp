#pragma once

#include "IDatasetRepository.hpp"
#include "training/entities/domain-objects/Tasks/TrainingTaskType.hpp"
#include "training/entities/domain-objects/DatasetConfig.hpp"
#include "training/entities/domain-objects/DatasetSplit.hpp"
#include <memory>

class IDatasetRepositoryFactory
{
public:
    virtual ~IDatasetRepositoryFactory() = default;
    virtual std::shared_ptr<IDatasetRepository> create(const TrainingTaskType &taskType, const DatasetConfig &config, DatasetSplit split) const = 0;
};