#pragma once

#include <memory>
#include <vector>

#include "training/entities/domain-objects/AppConfig.hpp"

// インターフェース、クラスの前方宣言
class TrainParam;
class IModelTrainer;
class IModelEvaluator;
class TrainingDatasets;

class TrainModelUsecase
{
private:
    std::shared_ptr<TrainParam> _param;
    AppConfig _appConfig;
    std::shared_ptr<IModelTrainer> _trainer;
    std::shared_ptr<IModelEvaluator> _evaluator;

public:
    TrainModelUsecase(const std::shared_ptr<TrainParam> &param, const AppConfig &appConfig, const std::shared_ptr<IModelTrainer> &trainer, const std::shared_ptr<IModelEvaluator> &evaluator);

    ~TrainModelUsecase() = default;

    void execute(const TrainingDatasets &datasets);
};
