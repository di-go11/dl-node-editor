#pragma once

#include "training/application/interfaces/ICheckpointStore.hpp"

#include <memory>
#include <string>

class IModel;
class IOptimizer;

class TorchCheckpointStore : public ICheckpointStore
{
public:
    TorchCheckpointStore(std::shared_ptr<IModel> model, std::shared_ptr<IOptimizer> optimizer, std::string outputDir, std::string modelName);
    void saveBest(const CheckpointMeta &meta) override;
    void saveLast(const CheckpointMeta &meta) override;
    CheckpointMeta loadBest() override;
    CheckpointMeta loadLast() override;
    CheckpointMeta loadFrom(const std::string &checkpointPath) override;

private:
    // 管理下のどのチェックポイントファイルを指すか(実装詳細)。
    enum class CheckpointKind
    {
        Best,
        Last,
    };

    std::shared_ptr<IModel> _model;
    std::shared_ptr<IOptimizer> _optimizer;
    std::string _outputDir;
    std::string _modelName;
    std::string checkpointPath(CheckpointKind kind) const;
    void writeCheckpoint(const std::string &path, const CheckpointMeta &meta);
};
