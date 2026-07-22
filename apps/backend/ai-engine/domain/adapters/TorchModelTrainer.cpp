#include "./TorchModelTrainer.hpp"
#include <torch/torch.h>

TorchModelTrainer::TorchModelTrainer(const std::shared_ptr<Modelarchitecture> &modelArch, const std::string &weightPath, const std::string &graphPath)
    : _modelArch(modelArch), _weightPath(weightPath), _graphPath(graphPath) {}

TorchModelTrainer::~TorchModelTrainer() = default;

void TorchModelTrainer::train(BatchData *batchData)
{
}