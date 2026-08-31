#pragma once

#include <memory>
#include "training/application/interfaces/IModelTrainer.hpp"

class IModel;
class ILoss;
class IOptimizer;
class IActivation;
class TrainParam;

class TorchModelTrainer : public IModelTrainer
{
private:
    const std::shared_ptr<IModel> _model;
    const std::shared_ptr<ILoss> _loss;
    const std::shared_ptr<IOptimizer> _optimizer;
    const std::shared_ptr<IActivation> _activation;

public:
    TorchModelTrainer(
        const std::shared_ptr<IModel> &model,
        const std::shared_ptr<ILoss> &loss,
        const std::shared_ptr<IOptimizer> &optimizer,
        const std::shared_ptr<IActivation> &activation);
    ~TorchModelTrainer() override;

    void train(
        BatchData<NormalizedImageData> &inputBatchData,
        BatchData<ImageData> &targetBatchData,
        TrainParam &trainParam) override;
};
