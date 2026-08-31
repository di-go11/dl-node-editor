#pragma once

#include <memory>
#include <vector>

#include "training/entities/domain-objects/AppConfig.hpp"

// インターフェース、クラスの前方宣言
class TrainParam;
class IModelTrainer;
class IDatasetRepository;

class TrainModelUsecase
{
private:
    std::shared_ptr<TrainParam> _param;
    AppConfig _appConfig;
    std::shared_ptr<IModelTrainer> _trainer;
    std::shared_ptr<IDatasetRepository> _datasetRepository;

public:
    TrainModelUsecase(const std::shared_ptr<TrainParam> &param, const AppConfig &appConfig, const std::shared_ptr<IModelTrainer> &trainer);
    ~TrainModelUsecase() = default;

    void execute(IDatasetRepository *dataset);
};
