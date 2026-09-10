#include "training/infrastructure/torchModel/CheckpointModelLoader.hpp"

#include "training/adapters/interfaces/IModel.hpp"
#include "training/adapters/interfaces/IModelFactory.hpp"
#include "training/adapters/interfaces/IOptimizer.hpp"
#include "training/adapters/interfaces/IOptimizerFactory.hpp"
#include "training/infrastructure/torchModel/CheckpointArchiveIO.hpp"

#include <filesystem>
#include <stdexcept>
#include <utility>

CheckpointModelLoader::CheckpointModelLoader(std::shared_ptr<IModelFactory> modelFactory,
                                             std::shared_ptr<IOptimizerFactory> optimizerFactory)
    : _modelFactory(std::move(modelFactory)),
      _optimizerFactory(std::move(optimizerFactory))
{
    if (_modelFactory == nullptr || _optimizerFactory == nullptr)
    {
        throw std::runtime_error("CheckpointModelLoader: factory must not be null");
    }
}

RestoredCheckpoint CheckpointModelLoader::load(const std::string &checkpointPath,
                                               const OptimizerConfig &optimizerConfig,
                                               const ComputeDevice &device)
{
    if (!std::filesystem::exists(checkpointPath))
    {
        throw std::runtime_error("CheckpointModelLoader::load: checkpoint not found: " + checkpointPath);
    }

    torch::serialize::InputArchive archive;
    archive.load_from(checkpointPath);

    RestoredCheckpoint restored;

    // 1. 構造を読む(モデルより先。ここが Phase 2 で追加された部分)
    restored.graph = readModelGraphFromCheckpoint(archive);

    // 2. 構造からモデルを組む
    restored.model = _modelFactory->create(restored.graph, device);

    // 3. モデルのパラメータに optimizer を結び付ける
    //    parameters() はモデル内部と記憶域を共有するので、RestoredCheckpoint に
    //    持たせたまま返し、optimizer の参照先が生き続けるようにする。
    restored.parameters = restored.model->parameters();
    restored.optimizer = _optimizerFactory->create(restored.parameters, optimizerConfig);

    // 4. 重み・optimizer 状態・メタ情報を流し込む
    //    graph は checkpoint 由来なので fingerprint 照合は必ず通る(自己整合性の確認)。
    restored.meta = readCheckpointArchive(archive, *restored.model, *restored.optimizer, restored.graph);

    // 5. 乱数状態をプロセスのグローバル生成器へ復元する。
    //    これは学習再開の経路(=このクラス)でのみ行う。
    restored.rngStateRestored = restoreCpuRngStateIfPresent(archive);

    return restored;
}
