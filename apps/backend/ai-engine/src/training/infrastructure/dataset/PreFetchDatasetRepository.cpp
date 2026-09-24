#include "training/infrastructure/dataset/PreFetchDatasetRepository.hpp"

PreFetchDatasetRepository::PreFetchDatasetRepository(std::shared_ptr<IDatasetRepository> datasetRepository)
    : _datasetRepository(std::move(datasetRepository))
{
}

void PreFetchDatasetRepository::reset()
{
    _datasetRepository->reset();
}

bool PreFetchDatasetRepository::hasNext() const
{
    return _datasetRepository->hasNext();
}

TrainingBatch PreFetchDatasetRepository::getNextBatch()
{
    return _datasetRepository->getNextBatch();
}