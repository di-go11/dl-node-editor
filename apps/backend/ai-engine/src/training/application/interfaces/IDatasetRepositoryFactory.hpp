#pragma once

#include "IDatasetRepository.hpp"
#include "training/entities/domain-objects/DataSpecs/DataSpec.hpp"
#include "training/entities/domain-objects/DatasetSplit.hpp"
#include <memory>
#include <string>

class IDatasetRepositoryFactory
{
public:
    virtual ~IDatasetRepositoryFactory() = default;
    // spec: データ形式ごとの仕様(タスク・アノテーション形式・入力サイズなど)
    // datasetPath: データセットのルートディレクトリ。仕様ではなく「どのデータを使うか」なので spec とは分けて渡す。
    virtual std::shared_ptr<IDatasetRepository> create(const DataSpec &spec, const std::string &datasetPath, DatasetSplit split) const = 0;
};
