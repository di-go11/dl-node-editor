#pragma once

#include "training/application/interfaces/IModelEvaluator.hpp"

#include <cstdint>

class IModel;
class ILoss;

class TorchModelEvaluator : public IModelEvaluator
{
public:
    // ignoreIndex: 損失・指標の計算から除外するターゲット値。
    // Letterbox リサイズがマスク余白を埋める値(既定 255)と一致させる。
    TorchModelEvaluator(IModel &model, ILoss &loss, int numClasses, int64_t ignoreIndex = 255);
    EpochMetrics evaluate(IDatasetRepository &valData) override;

private:
    IModel &_model;
    ILoss &_loss;
    int _numClasses;
    int64_t _ignoreIndex;
};
