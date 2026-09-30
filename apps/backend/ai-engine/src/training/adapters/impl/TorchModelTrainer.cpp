#include <torch/torch.h>

#include "./TorchModelTrainer.hpp"
#include "./BatchTensorConverter.hpp"

#include "../../entities/domain-objects/Metrics/EpochMetrics.hpp"
#include "../../entities/domain-objects/TrainingBatch.hpp"
#include "../../entities/domain-objects/BatchData.hpp"
#include "../../entities/image/ImageData.hpp"
#include "../../entities/image/NormalizedImageData.hpp"

#include "../interfaces/IModel.hpp"
#include "../interfaces/ILoss.hpp"
#include "../interfaces/IOptimizer.hpp"
#include "training/application/interfaces/IDatasetRepository.hpp"

TorchModelTrainer::TorchModelTrainer(
    const std::shared_ptr<IModel> &model,
    const std::shared_ptr<ILoss> &loss,
    const std::shared_ptr<IOptimizer> &optimizer)
    : _model(model),
      _loss(loss),
      _optimizer(optimizer)
{
}

TorchModelTrainer::~TorchModelTrainer() = default;

EpochMetrics TorchModelTrainer::trainOneEpoch(IDatasetRepository &trainData)
{
    BatchTensorConverter converter;

    _model->setTrain();

    double lossSum = 0.0;
    int64_t pixelCount = 0;

    trainData.reset();
    while (trainData.hasNext())
    {
        TrainingBatch batch = trainData.getNextBatch();

        torch::Tensor input = converter.convert(batch.input);        // [N,C,H,W] float
        torch::Tensor target = converter.convertTarget(batch.target); // [N,H,W]   int64

        torch::Tensor loss = _model->trainStep(input, target, *_loss, *_optimizer);

        lossSum += loss.item<double>() * target.numel();
        pixelCount += target.numel();
    }

    EpochMetrics metrics;
    metrics.loss = pixelCount > 0 ? lossSum / static_cast<double>(pixelCount) : 0.0;
    // タスク別の指標(pixelAccuracy / mIoU など)は学習中の集計コストを避け、validation 側で測る方針。
    // taskMetrics は既定値(先頭の型をゼロ初期化したもの)のままなので、学習側では参照しないこと。
    return metrics;
}
