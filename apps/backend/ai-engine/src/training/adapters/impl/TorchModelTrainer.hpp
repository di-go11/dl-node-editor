#pragma once

#include <memory>
#include "training/application/interfaces/IModelTrainer.hpp"

class IModel;
class ILoss;
class IOptimizer;
class ILearningRateScheduler;
class IDatasetRepository;
struct EpochMetrics;

class TorchModelTrainer : public IModelTrainer
{
private:
    const std::shared_ptr<IModel> _model;
    const std::shared_ptr<ILoss> _loss;
    const std::shared_ptr<IOptimizer> _optimizer;
    const std::shared_ptr<ILearningRateScheduler> _lrScheduler; // nullptr なら学習率を変えない(Optimizer の設定値のまま)

public:
    TorchModelTrainer(
        const std::shared_ptr<IModel> &model,
        const std::shared_ptr<ILoss> &loss,
        const std::shared_ptr<IOptimizer> &optimizer,
        const std::shared_ptr<ILearningRateScheduler> &lrScheduler);
    ~TorchModelTrainer() override;

    EpochMetrics trainOneEpoch(IDatasetRepository &trainData, unsigned int nowEpoch) override;
    double learningRate() const override;
};
