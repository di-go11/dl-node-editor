#include "training/infrastructure/torchModel/TorchModelStore.hpp"
#include "training/adapters/interfaces/IModel.hpp"
#include "training/infrastructure/torchModel/TorchModel.hpp"

#include <torch/serialize.h>

void TorchModelStore::save(const IModel &model, const std::string &path)
{
    const auto &torchModel = dynamic_cast<const TorchModel &>(model);
    torch::save(torchModel.parameters(), path);
}