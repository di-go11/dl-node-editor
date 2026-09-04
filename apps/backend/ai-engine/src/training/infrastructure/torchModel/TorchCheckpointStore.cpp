#include "training/infrastructure/torchModel/TorchCheckpointStore.hpp"
#include "training/adapters/interfaces/IModel.hpp"
#include "training/adapters/interfaces/IOptimizer.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointArchive.hpp"
#include "training/entities/domain-objects/ModelGraphFingerprint.hpp"
#include <torch/torch.h>
#include <filesystem>
#include <iostream>
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

    torch::serialize::OutputArchive modelArchive;
    TorchCheckpointWriter modelWriter(modelArchive);
    _model->writeTo(modelWriter);
    archive.write("model", modelArchive);

    torch::serialize::OutputArchive optimArchive;
    TorchCheckpointWriter optimWriter(optimArchive);
    _optimizer->writeTo(optimWriter);
    archive.write("optimizer", optimArchive);

    archive.write("epoch", torch::tensor(static_cast<int64_t>(meta.epoch)));
    // torch::tensor(double) は float32 になり精度が落ちるため kFloat64 を明示する。
    archive.write("best_metric", torch::tensor(meta.bestMetric, torch::kFloat64));

    archive.write("model_graph_fingerprint", c10::IValue(modelGraphFingerprint(_modelGraph)));

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

    // モデル構造の照合

    c10::IValue fingerprintIValue;
    if (archive.try_read("model_graph_fingerprint", fingerprintIValue))
    {
        const std::string stored = fingerprintIValue.toStringRef();
        const std::string current = modelGraphFingerprint(_modelGraph);
        if (stored != current)
        {
            throw std::runtime_error("TorchCheckpointStore::loadFrom: model graph fingerprint mismatch. (checkpoint=" + stored + ", current=" + current + ")");
        }
    }
    else
    {
        std::cerr << "[warn] checkpoint に fingerprint がありません（旧形式）。構造チェックをスキップします\n";
    }

    torch::serialize::InputArchive modelArchive;
    archive.read("model", modelArchive);
    TorchCheckpointReader modelReader(modelArchive);
    _model->readFrom(modelReader);

    torch::serialize::InputArchive optimArchive;
    archive.read("optimizer", optimArchive);
    TorchCheckpointReader optimReader(optimArchive);
    _optimizer->readFrom(optimReader);

    at::Tensor epochTensor;
    archive.read("epoch", epochTensor);
    at::Tensor bestMetricTensor;
    archive.read("best_metric", bestMetricTensor);

    return CheckpointMeta{
        static_cast<unsigned int>(epochTensor.item<int64_t>()),
        bestMetricTensor.item<double>()};
}