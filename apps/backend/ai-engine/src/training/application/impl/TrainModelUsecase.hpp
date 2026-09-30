#pragma once

#include <memory>
#include <string>

#include "training/application/impl/TrainingResumeState.hpp"

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
    unsigned int _saveLastEvery; // 「直近」チェックポイントを何エポックごとに書くか(0 = 毎エポック)
    std::shared_ptr<IModelTrainer> _trainer;
    std::shared_ptr<IModelEvaluator> _evaluator;
    std::shared_ptr<ICheckpointStore> _checkpointStore;

public:
    TrainModelUsecase(const std::shared_ptr<TrainParam> &param,
                      unsigned int saveLastEvery,
                      const std::shared_ptr<IModelTrainer> &trainer,
                      const std::shared_ptr<IModelEvaluator> &evaluator,
                      const std::shared_ptr<ICheckpointStore> &checkpointStore);

    ~TrainModelUsecase() = default;

    // resume を省略すると cold start(epoch 0 から、ベスト値なし)。
    // 中断・再開する場合は合成層が checkpoint から組み立てた開始状態を渡す。
    void execute(const TrainingDatasets &datasets, const TrainingResumeState &resume = {});
};
