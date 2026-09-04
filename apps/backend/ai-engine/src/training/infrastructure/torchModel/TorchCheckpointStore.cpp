#include "training/infrastructure/torchModel/TorchCheckpointStore.hpp"
#include "training/adapters/interfaces/IModel.hpp"
#include "training/adapters/interfaces/IOptimizer.hpp"
#include "training/infrastructure/torchModel/CheckpointArchiveIO.hpp"
#include <torch/torch.h>
#include <filesystem>
#include <stdexcept>
#include <utility>

TorchCheckpointStore::TorchCheckpointStore(std::shared_ptr<IModel> model,
                                           std::shared_ptr<IOptimizer> optimizer,
                                           std::string outputDir,
                                           std::string modelName,
                                           ModelGraph modelGraph)
    : _model(std::move(model)),
      _optimizer(std::move(optimizer)),
      _outputDir(std::move(outputDir)),
      _modelName(std::move(modelName)),
      _modelGraph(std::move(modelGraph)) {}

std::string TorchCheckpointStore::checkpointPath(CheckpointKind kind) const
{
    const std::string name = _modelName.empty() ? "model" : _modelName;

    switch (kind)
    {
    case CheckpointKind::Best:
        return (std::filesystem::path(_outputDir) / (name + "_best.pt")).string();
    case CheckpointKind::Last:
        return (std::filesystem::path(_outputDir) / (name + "_last.pt")).string();
    default:
        throw std::runtime_error("TorchCheckpointStore::checkpointPath: unknown kind");
    }
}

void TorchCheckpointStore::writeCheckpoint(const std::string &path, const CheckpointMeta &meta)
{
    std::filesystem::create_directories(std::filesystem::path(path).parent_path());

    torch::serialize::OutputArchive archive;
    writeCheckpointArchive(archive, *_model, *_optimizer, _modelGraph, meta);
    archive.save_to(path);
}

void TorchCheckpointStore::saveBest(const CheckpointMeta &meta) { writeCheckpoint(checkpointPath(CheckpointKind::Best), meta); }
void TorchCheckpointStore::saveLast(const CheckpointMeta &meta) { writeCheckpoint(checkpointPath(CheckpointKind::Last), meta); }

CheckpointMeta TorchCheckpointStore::loadBest()
{
    return loadFrom(checkpointPath(CheckpointKind::Best));
}

CheckpointMeta TorchCheckpointStore::loadLast()
{
    return loadFrom(checkpointPath(CheckpointKind::Last));
}

CheckpointMeta TorchCheckpointStore::loadFrom(const std::string &checkpointPath)
{
    if (!std::filesystem::exists(checkpointPath))
    {
        throw std::runtime_error("TorchCheckpointStore::loadFrom: checkpoint not found: " + checkpointPath);
    }

    torch::serialize::InputArchive archive;
    archive.load_from(checkpointPath);

    // 注入済みの _model / _optimizer へ in-place 復元する(構造は変えない)。
    // checkpoint から構造ごと作り直す経路は CheckpointModelLoader が担当。
    return readCheckpointArchive(archive, *_model, *_optimizer, _modelGraph);
}