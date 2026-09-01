#pragma once

#include <memory>
#include <string>

#include "training/entities/domain-objects/AppConfig.hpp"

// インターフェース、クラスの前方宣言
class TrainParam;
class IModelTrainer;
class IModelEvaluator;
class IModel;
class IModelStore;
class TrainingDatasets;

class TrainModelUsecase
{
private:
    std::shared_ptr<TrainParam> _param;
    AppConfig _appConfig;
    std::shared_ptr<IModelTrainer> _trainer;
    std::shared_ptr<IModelEvaluator> _evaluator;
    std::shared_ptr<IModel> _model;
    std::shared_ptr<IModelStore> _modelStore;

    // ベストモデルの重みを書き出すパス(<outputDir>/<modelName>_best.pt)。
    std::string checkpointPath() const;

public:
    TrainModelUsecase(const std::shared_ptr<TrainParam> &param,
                      const AppConfig &appConfig,
                      const std::shared_ptr<IModelTrainer> &trainer,
                      const std::shared_ptr<IModelEvaluator> &evaluator,
                      const std::shared_ptr<IModel> &model,
                      const std::shared_ptr<IModelStore> &modelStore);

    ~TrainModelUsecase() = default;

    void execute(const TrainingDatasets &datasets);
};
