#include <torch/torch.h>

#include "./TorchModelTrainer.hpp"
#include "./BatchTensorConverter.hpp"

#include "training/entities/domain-objects/Metrics/EpochMetrics.hpp"
#include "training/entities/domain-objects/TrainingBatch.hpp"
#include "training/entities/domain-objects/BatchData.hpp"
#include "training/entities/image/ImageData.hpp"
#include "training/entities/image/NormalizedImageData.hpp"

#include "../interfaces/IModel.hpp"
#include "../interfaces/ILoss.hpp"
#include "../interfaces/IOptimizer.hpp"
#include "../interfaces/ILearningRateScheduler.hpp"
#include "training/application/interfaces/IDatasetRepository.hpp"

#include <cstdint>

TorchModelTrainer::TorchModelTrainer(
    const std::shared_ptr<IModel> &model,
    const std::shared_ptr<ILoss> &loss,
    const std::shared_ptr<IOptimizer> &optimizer,
    const std::shared_ptr<ILearningRateScheduler> &lrScheduler)
    : _model(model),
      _loss(loss),
      _optimizer(optimizer),
      _lrScheduler(lrScheduler)
{
}

TorchModelTrainer::~TorchModelTrainer() = default;

EpochMetrics TorchModelTrainer::trainOneEpoch(IDatasetRepository &trainData, unsigned int nowEpoch)
{
    // スケジューラーがない(None)ときは、学習率を Optimizer の設定値のまま変えない。
    const bool updatePerEpoch = _lrScheduler && _lrScheduler->getUpdateInterval() == LearningRateUpdateInterval::PerEpoch;
    const bool updatePerBatch = _lrScheduler && _lrScheduler->getUpdateInterval() == LearningRateUpdateInterval::PerBatch;

    if (updatePerEpoch)
    {
        // エポックの最初に、このエポックで使う学習率を設定する
        _optimizer->updateLearningRate(_lrScheduler->learningRateAt(nowEpoch));
    }

    BatchTensorConverter converter;

    _model->setTrain();

    double lossSum = 0.0;
    int64_t pixelCount = 0;

    trainData.reset();
    const uint64_t batchesPerEpoch = trainData.batchCount();

    for (uint64_t b = 0; trainData.hasNext(); ++b)
    {
        if (updatePerBatch)
        {
            // 各バッチを学習する前に、そのバッチで使う学習率を設定する。
            // step はエポック番号から計算するので、途中から再開しても中断しなかった場合と同じ値になる。
            const uint64_t step = static_cast<uint64_t>(nowEpoch) * batchesPerEpoch + b;
            _optimizer->updateLearningRate(_lrScheduler->learningRateAt(step));
        }
        TrainingBatch batch = trainData.getNextBatch();

        torch::Tensor input = converter.convert(batch.input);         // [N,C,H,W] float
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
