#include "training/infrastructure/torchModel/TorchCheckpointStore.hpp"
#include "training/adapters/interfaces/IModel.hpp"
#include "training/adapters/interfaces/IOptimizer.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointArchive.hpp"
#include <torch/torch.h>
#include <filesystem>
#include <utility>

TorchCheckpointStore::TorchCheckpointStore(std::shared_ptr<IModel> model,
                                           std::shared_ptr<IOptimizer> optimizer,
                                           std::string outputDir, std::string modelName)
    : _model(std::move(model)), _optimizer(std::move(optimizer)),
      _outputDir(std::move(outputDir)), _modelName(std::move(modelName)) {}

std::string TorchCheckpointStore::checkpointPath() const
{
    const std::string name = _modelName.empty() ? "model" : _modelName;
    return (std::filesystem::path(_outputDir) / (name + "_best.pt")).string();
}

void TorchCheckpointStore::saveBest(unsigned int epoch)
{
    const std::string path = checkpointPath();
    std::filesystem::create_directories(std::filesystem::path(path).parent_path());

    torch::serialize::OutputArchive archive;

    torch::serialize::OutputArchive modelArchive;
    TorchCheckpointWriter modelWriter(modelArchive);
    _model->writeTo(modelWriter);
    archive.write("model", modelArchive); // ← 前回作った仕組みをサブ archive で使う

    torch::serialize::OutputArchive optimArchive;
    TorchCheckpointWriter optimWriter(optimArchive);
    _optimizer->writeTo(optimWriter);
    archive.write("optimizer", optimArchive);

    archive.write("epoch", torch::tensor(static_cast<int64_t>(epoch)));
    archive.save_to(path); // model+optimizer+epoch を1ファイルに
}
