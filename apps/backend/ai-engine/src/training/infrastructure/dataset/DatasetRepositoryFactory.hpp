#pragma once

#include "training/application/interfaces/IDatasetRepositoryFactory.hpp"

class DatasetRepositoryFactory : public IDatasetRepositoryFactory
{
public:
    std::shared_ptr<IDatasetRepository> create(const TrainingTaskType &taskType, const DatasetConfig &config, DatasetSplit split) const override;

private:
    // ① モダリティ
    std::shared_ptr<IDatasetRepository> createImage(ImageTaskType, const DatasetConfig &, DatasetSplit) const;
    // ② 形式 (variant の型で分岐)
    std::shared_ptr<IDatasetRepository> createPascalVoc(ImageTaskType, const PascalVocConfig &, const DatasetConfig &, DatasetSplit) const;
    // ③ タスク (enum で分岐) は各 createXxx 内の switch
};