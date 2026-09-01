#pragma once

#include "training/application/interfaces/IModelEvaluator.hpp"

class IModel;
class ILoss;

class TorchModelEvaluator : public IModelEvaluator
{
public:
    explicit TorchModelEvaluator(IModel &model, ILoss &loss, int numClasses);
    EpochMetrics evaluate(IDatasetRepository &valData) override;

private:
    IModel &_model;
    ILoss &_loss;
    int _numClasses;
};
