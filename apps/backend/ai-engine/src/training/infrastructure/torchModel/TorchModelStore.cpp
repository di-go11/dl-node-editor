#include "training/infrastructure/torchModel/TorchModelStore.hpp"
#include "training/adapters/interfaces/IModel.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointArchive.hpp"

#include <torch/torch.h>

#include <filesystem>

void TorchModelStore::save(const IModel &model, const std::string &path)
{
    const std::filesystem::path parent = std::filesystem::path(path).parent_path();
    if (!parent.empty())
    {
        std::filesystem::create_directories(parent);
    }

    // シリアライズの中身は IModel 本人に任せ、Store は保存先・形式だけを扱う。
    torch::serialize::OutputArchive archive;
    TorchCheckpointWriter writer(archive);
    model.writeTo(writer);
    archive.save_to(path);
}

void TorchModelStore::load(IModel &model, const std::string &path)
{
    torch::serialize::InputArchive archive;
    archive.load_from(path);
    TorchCheckpointReader reader(archive);
    model.readFrom(reader);
}
