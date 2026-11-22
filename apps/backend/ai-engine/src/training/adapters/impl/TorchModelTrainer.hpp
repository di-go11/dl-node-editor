#pragma once

#include <memory>
#include "training/application/interfaces/IModelTrainer.hpp"
#include "training/application/interfaces/ILearningRateScheduler.hpp"

class IModel;
class ILoss;
class IOptimizer;
class IDatasetRepository;
struct EpochMetrics;

class TorchModelTrainer : public IModelTrainer
{
private:
    const std::shared_ptr<IModel> _model;
    const std::shared_ptr<ILoss> _loss;
    const std::shared_ptr<IOptimizer> _optimizer;
    const std::shared_ptr<ILearningRateScheduler> _lrScheduler;

public:
    TorchModelTrainer(
        const std::shared_ptr<IModel> &model,
        const std::shared_ptr<ILoss> &loss,
        const std::shared_ptr<IOptimizer> &optimizer,
        const std::shared_ptr<ILearningRateScheduler> &lrScheduler);
    ~TorchModelTrainer() override;

    EpochMetrics trainOneEpoch(IDatasetRepository &trainData) override;
};
