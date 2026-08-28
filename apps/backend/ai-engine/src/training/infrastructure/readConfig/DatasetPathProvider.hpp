#pragma once

#include "training/application/interfaces/IPathProvidor.hpp"

struct AppConfig;

// AppConfig(ConfigReaderが設定ファイルから読み込んだもの)が持つ
// datasetPathを返すIPathProvidorの具象実装
class DatasetPathProvider : public IPathProvidor
{
public:
    explicit DatasetPathProvider(const AppConfig &appConfig);

    std::string getPath() const override;

private:
    std::string _datasetPath;
};
