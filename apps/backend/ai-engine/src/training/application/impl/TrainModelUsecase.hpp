#pragma once

#include <memory>
#include <string>

#include "training/entities/domain-objects/AppConfig.hpp"

// インターフェース、クラスの前方宣言
class TrainParam;
class IModelTrainer;
class IModelEvaluator;
class TrainingDatasets;
class ICheckpointStore;

class TrainModelUsecase
{
private:
    std::shared_ptr<TrainParam> _param;
    AppConfig _appConfig;
    std::shared_ptr<IModelTrainer> _trainer;
    std::shared_ptr<IModelEvaluator> _evaluator;
    std::shared_ptr<ICheckpointStore> _checkpointStore;

public:
    TrainModelUsecase(const std::shared_ptr<TrainParam> &param,
                      const AppConfig &appConfig,
                      const std::shared_ptr<IModelTrainer> &trainer,
                      const std::shared_ptr<IModelEvaluator> &evaluator,
                      const std::shared_ptr<ICheckpointStore> &checkpointStore);

    ~TrainModelUsecase() = default;

    void execute(const TrainingDatasets &datasets);
};
