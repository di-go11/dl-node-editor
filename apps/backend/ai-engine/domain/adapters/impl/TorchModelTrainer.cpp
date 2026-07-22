#include "./TorchModelTrainer.hpp"
#include "./BatchTensorConverter.hpp"

#include "../../entities/domain-objects/BatchData.hpp"

#include <torch/torch.h>

TorchModelTrainer::TorchModelTrainer(const std::shared_ptr<IModelarchitecture> &modelArch, const std::string &weightPath, const std::string &graphPath)
    : _modelArch(modelArch), _weightPath(weightPath), _graphPath(graphPath) {}

TorchModelTrainer::~TorchModelTrainer() = default;

void TorchModelTrainer::train(BatchData *batchData)
{
    if (batchData == nullptr)
    {
        return;
    }

    BatchTensorConverter converter;
    const auto inputTensor = converter.convert(*batchData);
}