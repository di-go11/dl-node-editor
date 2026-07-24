#include "./TorchModelTrainer.hpp"
#include "./BatchTensorConverter.hpp"

#include <torch/torch.h>

#include <stdexcept>
#include <utility>

#include "../../entities/domain-objects/TrainParam.hpp"
#include "../../entities/domain-objects/BatchData.hpp"

#include "../interfaces/IForward.hpp"
#include "../interfaces/IBackward.hpp"
#include "../interfaces/ILoss.hpp"
#include "../interfaces/IOptimizer.hpp"
#include "../interfaces/IZeroGrad.hpp"

namespace torch
{
    class Tensor;
};

TorchModelTrainer::TorchModelTrainer(
    const std::shared_ptr<IModelAchManager> &forward,
    const std::shared_ptr<ILoss> &loss,
    const std::shared_ptr<IBackward> &backward,
    const std::shared_ptr<IOptimizer> &optimizer,
    const std::shared_ptr<IZeroGrad> &zerograd,
    const std::string &weightPath,
    const std::string &graphPath)
    : _forward(forward),
      _loss(loss),
      _backward(backward),
      _optimizer(optimizer),
      _zerograd(zerograd),
      _weightPath(weightPath),
      _graphPath(graphPath)
{
}

TorchModelTrainer::~TorchModelTrainer() = default;

void TorchModelTrainer::train(BatchData &predictionBatchData, BatchData &targetBatchData, TrainParam &trainParam)
{
    BatchTensorConverter converter;

    torch::Tensor convertedPredictionTensor = converter.convert(predictionBatchData);
    torch::Tensor convertedTargetTensor = converter.convert(targetBatchData);
    torch::Tensor forwardedTensor = _forward->computeForward(std::move(convertedPredictionTensor));
    torch::Tensor lossedTensor = _loss->computeLoss(trainParam, forwardedTensor, convertedTargetTensor);
    torch::Tensor backwardedTensor = _backward->computeBackword(lossedTensor);

    (void)backwardedTensor;
    (void)_optimizer;
    (void)_zerograd;
    (void)_weightPath;
    (void)_graphPath;
}