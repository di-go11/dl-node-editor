#include <torch/torch.h>

#include "./TorchModelTrainer.hpp"
#include "./BatchTensorConverter.hpp"

#include "../../entities/domain-objects/TrainParam.hpp"
#include "../../entities/domain-objects/BatchData.hpp"

#include "../interfaces/IModel.hpp"
#include "../interfaces/ILoss.hpp"
#include "../interfaces/IOptimizer.hpp"
#include "../interfaces/IActivation.hpp"

TorchModelTrainer::TorchModelTrainer(
    const std::shared_ptr<IModel> &model,
    const std::shared_ptr<ILoss> &loss,
    const std::shared_ptr<IOptimizer> &optimizer,
    const std::shared_ptr<IActivation> &activation)
    : _model(model),
      _loss(loss),
      _optimizer(optimizer),
      _activation(activation)
{
}

TorchModelTrainer::~TorchModelTrainer() = default;

void TorchModelTrainer::train(BatchData &inputBatchData, BatchData &targetBatchData, TrainParam &trainParam)
{
    BatchTensorConverter converter;

    torch::Tensor predictionTensor = converter.convert(inputBatchData);
    torch::Tensor targetTensor = converter.convert(targetBatchData);

    _model->train(predictionTensor, targetTensor, *_loss, *_optimizer, *_activation);
}
