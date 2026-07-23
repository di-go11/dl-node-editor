#include "./TorchModelTrainer.hpp"
#include "./BatchTensorConverter.hpp"

#include "../../entities/domain-objects/TrainParam.hpp"
#include "../../entities/domain-objects/BatchData.hpp"

#include "../interfaces/IForward.hpp"
#include "../interfaces/IBackward.hpp"
#include "../interfaces/ILossComputation.hpp"
#include "../interfaces/IOptimization.hpp"

namespace torch
{
    class Tensor;
};

TorchModelTrainer::TorchModelTrainer(const std::shared_ptr<IModelAchManager> &modelArch, const std::string &weightPath, const std::string &graphPath)
    : _modelArch(modelArch), _weightPath(weightPath), _graphPath(graphPath) {}

TorchModelTrainer::~TorchModelTrainer() = default;

void TorchModelTrainer::train(BatchData *batchData, TrainParam *trainParam)
{
    if (batchData == nullptr)
    {
        throw std::invalid_argument("No data in BatchData");
    }

    BatchTensorConverter converter;
    const auto rawTensor = converter.convert(*batchData);
    torch::Tensor outputTensor = (_modelArch->forward(rawTensor));
}