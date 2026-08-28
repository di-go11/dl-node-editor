#include "training/infrastructure/readConfig/DatasetPathProvider.hpp"
#include "training/entities/domain-objects/AppConfig.hpp"

DatasetPathProvider::DatasetPathProvider(const AppConfig &appConfig)
    : _datasetPath(appConfig.datasetPath)
{
}

std::string DatasetPathProvider::getPath() const
{
    return _datasetPath;
}
