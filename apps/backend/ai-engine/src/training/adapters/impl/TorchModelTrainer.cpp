#include <torch/torch.h>

#include "./TorchModelTrainer.hpp"
#include "./BatchTensorConverter.hpp"

#include "../../entities/domain-objects/TrainParam.hpp"
#include "../../entities/domain-objects/BatchData.hpp"
#include "../../entities/image/ImageData.hpp"
#include "../../entities/image/NormalizedImageData.hpp"

#include "../interfaces/IModel.hpp"
#include "../interfaces/ILoss.hpp"
#include "../interfaces/IOptimizer.hpp"

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

void TorchModelTrainer::train(
    BatchData<NormalizedImageData> &inputBatchData,
    BatchData<ImageData> &targetBatchData,
    TrainParam &trainParam)
{
    BatchTensorConverter converter;

    torch::Tensor predictionTensor = converter.convert(inputBatchData);      // [N,C,H,W] float
    torch::Tensor targetTensor = converter.convertTarget(targetBatchData);   // [N,H,W] int64(クラスID)

    _model->train(predictionTensor, targetTensor, *_loss, *_optimizer);
}
