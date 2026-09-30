#pragma once

#include <memory>
#include <string>

#include "training/application/impl/TrainingResumeState.hpp"
#include "training/entities/domain-objects/TrainingStatus.hpp"

// インターフェース、クラスの前方宣言
class TrainParam;
class IModelTrainer;
class IModelEvaluator;
class TrainingDatasets;
class ICheckpointStore;
class ITrainingProgressObserver;
class TrainingStopToken;

class TrainModelUsecase
{
private:
    std::shared_ptr<TrainParam> _param;
    unsigned int _saveLastEvery; // 「直近」チェックポイントを何エポックごとに書くか(0 = 毎エポック)
    std::shared_ptr<IModelTrainer> _trainer;
    std::shared_ptr<IModelEvaluator> _evaluator;
    std::shared_ptr<ICheckpointStore> _checkpointStore;
    std::shared_ptr<ITrainingProgressObserver> _progressObserver; // エポックごとの結果の通知先

public:
    TrainModelUsecase(const std::shared_ptr<TrainParam> &param,
                      unsigned int saveLastEvery,
                      const std::shared_ptr<IModelTrainer> &trainer,
                      const std::shared_ptr<IModelEvaluator> &evaluator,
                      const std::shared_ptr<ICheckpointStore> &checkpointStore,
                      const std::shared_ptr<ITrainingProgressObserver> &progressObserver);

    ~TrainModelUsecase() = default;

    // resume を省略すると cold start(epoch 0 から、ベスト値なし)。
    // 中断・再開する場合は合成層が checkpoint から組み立てた開始状態を渡す。
    // stopToken が停止を要求していれば、エポックの区切りで抜ける(nullptr なら止められない)。
    // 戻り値: 最後まで回れば Completed、停止要求で抜ければ Stopped。
    // 終了の通知(ITrainingProgressObserver::onFinished)は呼ばない。例外による失敗も含めて、呼び出し側がまとめて通知する。
    TrainingStatus execute(const TrainingDatasets &datasets,
                           const TrainingResumeState &resume = {},
                           const TrainingStopToken *stopToken = nullptr);
};
