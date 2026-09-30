#pragma once

#include "training/application/interfaces/IModelEvaluator.hpp"
#include "training/entities/domain-objects/DataSpecs/ImageTaskSpecs.hpp"

#include <cstdint>

class IModel;
class ILoss;

class TorchModelEvaluator : public IModelEvaluator
{
public:
    // taskSpecs: 評価するタスクの仕様。evaluate() はこれを visit して、タスクに合った指標を計算する。
    //   SegmentationSpec の ignoreIndex(Letterbox 余白を埋める値)のピクセルは損失・指標の計算から除外する。
    TorchModelEvaluator(IModel &model, ILoss &loss, int numClasses, ImageTaskSpecs taskSpecs);
    EpochMetrics evaluate(IDatasetRepository &valData) override;

private:
    EpochMetrics evaluateSegmentation(IDatasetRepository &valData, int64_t ignoreIndex);

    IModel &_model;
    ILoss &_loss;
    int _numClasses;
    ImageTaskSpecs _taskSpecs;
};
