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
                                           std::string modelId,
                                           ModelGraph modelGraph)
    : _model(std::move(model)),
      _optimizer(std::move(optimizer)),
      _outputDir(std::move(outputDir)),
      _modelId(std::move(modelId)),
      _modelGraph(std::move(modelGraph))
{
    // 空のまま既定名にすると、別モデルの学習どうしが同じファイルを上書き・再開してしまうため拒否する。
    if (_modelId.empty())
    {
        throw std::invalid_argument("TorchCheckpointStore: modelId が空です");
    }
}

std::string TorchCheckpointStore::lastCheckpointPath(const std::string &outputDir, const std::string &modelId)
{
    return (std::filesystem::path(outputDir) / (modelId + "_last.pt")).string();
}

std::string TorchCheckpointStore::checkpointPath(CheckpointKind kind) const
{
    switch (kind)
    {
    case CheckpointKind::Best:
        return (std::filesystem::path(_outputDir) / (_modelId + "_best.pt")).string();
    case CheckpointKind::Last:
        return lastCheckpointPath(_outputDir, _modelId);
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