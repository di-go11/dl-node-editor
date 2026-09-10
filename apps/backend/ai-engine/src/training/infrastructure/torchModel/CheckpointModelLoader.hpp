#pragma once

#include <torch/torch.h>

#include <memory>
#include <string>
#include <vector>

#include "training/entities/domain-objects/CheckpointMeta.hpp"
#include "training/entities/domain-objects/ComputeDevice.hpp"
#include "training/entities/domain-objects/ModelGraph.hpp"
#include "training/entities/domain-objects/OptimizerConfig.hpp"

class IModel;
class IModelFactory;
class IOptimizer;
class IOptimizerFactory;

// checkpoint から復元された一式。
struct RestoredCheckpoint
{
    std::shared_ptr<IModel> model;
    std::shared_ptr<IOptimizer> optimizer;
    // model 内部と記憶域を共有するパラメータハンドル。optimizer が参照しているため、
    // optimizer を使い続ける間は保持しておくこと。
    std::vector<at::Tensor> parameters;
    ModelGraph graph; // checkpoint に記録されていたモデル構造
    CheckpointMeta meta;

    // CPU 乱数生成器の状態をグローバル生成器へ復元できたか。
    // false は「rng_state_cpu を持たない旧 checkpoint だった」ことを意味し、
    // 学習は続行できるが乱数列は保存時の続きにならない。
    bool rngStateRestored = false;
};

// checkpoint(.pt)1 つだけを入力に、モデル構造の再構築から重み・optimizer 状態の
// 復元までを行う。
//
// TorchCheckpointStore との違い:
//   - TorchCheckpointStore : 構築済みの model / optimizer を注入され、in-place に復元する。
//                            保存(saveBest / saveLast)も担当。
//   - CheckpointModelLoader: model / optimizer を「持たない」状態から作り出す。
//                            呼び出し側が保存時と同じ ModelGraph を用意する必要がない。
class CheckpointModelLoader
{
public:
    CheckpointModelLoader(std::shared_ptr<IModelFactory> modelFactory,
                          std::shared_ptr<IOptimizerFactory> optimizerFactory);

    // checkpointPath の .pt を読み、モデル構造 → モデル → optimizer の順に組み立て、
    // 重み・optimizer 状態・メタ情報を復元して返す。
    // optimizerConfig は「どの Optimizer を どのハイパーパラメータで作るか」。
    // (Optimizer の種別・LR は checkpoint に記録していないため、呼び出し側が与える)
    // ファイルが存在しない / model_graph を含まない場合は std::runtime_error。
    // device は復元したモデルを配置する計算デバイス。保存時と異なる device を
    // 指定してよい(例: cuda で学習した checkpoint を cpu で再開)。
    RestoredCheckpoint load(const std::string &checkpointPath,
                            const OptimizerConfig &optimizerConfig,
                            const ComputeDevice &device);

private:
    std::shared_ptr<IModelFactory> _modelFactory;
    std::shared_ptr<IOptimizerFactory> _optimizerFactory;
};
