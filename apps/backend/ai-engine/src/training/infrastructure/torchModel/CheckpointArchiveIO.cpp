#include "training/infrastructure/torchModel/CheckpointArchiveIO.hpp"

#include "training/adapters/interfaces/IModel.hpp"
#include "training/adapters/interfaces/IOptimizer.hpp"
#include "training/entities/domain-objects/ModelGraphFingerprint.hpp"
#include "training/entities/domain-objects/OptimizerTypeName.hpp"
#include "training/infrastructure/torchModel/ModelGraphArchive.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointArchive.hpp"

#include <ATen/CPUGeneratorImpl.h>
#include <ATen/core/Generator.h>
#include <torch/torch.h>

#include <iostream>
#include <mutex>
#include <stdexcept>

namespace
{
    // プロセス共有の CPU 乱数生成器の状態を 1 次元 uint8 テンソルとして取り出す。
    // Generator はハンドル(intrusive_ptr ラッパ)なので、コピーしても同じ実体を指す。
    // mutex() が非 const メンバのため、非 const のローカルに受けてからロックする。
    at::Tensor currentCpuRngState()
    {
        at::Generator gen = at::detail::getDefaultCPUGenerator();
        std::lock_guard<std::mutex> lock(gen.mutex());
        return gen.get_state();
    }

    void applyCpuRngState(const at::Tensor &state)
    {
        at::Generator gen = at::detail::getDefaultCPUGenerator();
        std::lock_guard<std::mutex> lock(gen.mutex());
        gen.set_state(state);
    }
} // namespace

void writeCheckpointArchive(torch::serialize::OutputArchive &archive,
                            const IModel &model, const IOptimizer &optimizer,
                            const ModelGraph &graph, const CheckpointMeta &meta)
{
    torch::serialize::OutputArchive modelArchive;
    TorchCheckpointWriter modelWriter(modelArchive);
    model.writeTo(modelWriter);
    archive.write("model", modelArchive);

    torch::serialize::OutputArchive optimArchive;
    TorchCheckpointWriter optimWriter(optimArchive);
    optimizer.writeTo(optimWriter);
    archive.write("optimizer", optimArchive);

    // Optimizer の種別。状態の中身(Adam の exp_avg / SGD の momentum_buffer など)は
    // 種別ごとに全く違うため、復元時に取り違えを検出できるよう名前を残す。
    archive.write("optimizer_type", c10::IValue(optimizerTypeName(optimizer.type())));

    archive.write("epoch", torch::tensor(static_cast<int64_t>(meta.epoch)));
    // torch::tensor(double) は float32 になり精度が落ちるため kFloat64 を明示する。
    archive.write("best_metric", torch::tensor(meta.bestMetric, torch::kFloat64));

    archive.write("model_graph_fingerprint", c10::IValue(modelGraphFingerprint(graph)));

    // モデル構造そのもの。checkpoint 単体からのモデル再構築で読む。
    torch::serialize::OutputArchive graphArchive;
    writeModelGraph(graphArchive, graph);
    archive.write("model_graph", graphArchive);

    // CPU 乱数生成器の状態。学習再開時に「保存時の続きの乱数列」で回すため。
    archive.write("rng_state_cpu", currentCpuRngState());
}

CheckpointMeta readCheckpointArchive(torch::serialize::InputArchive &archive,
                                     IModel &model, IOptimizer &optimizer,
                                     const ModelGraph &expectedGraph)
{
    // モデル構造の照合。壊れた重みを読み込む前に弾く。
    c10::IValue fingerprintIValue;
    if (archive.try_read("model_graph_fingerprint", fingerprintIValue))
    {
        const std::string stored = fingerprintIValue.toStringRef();
        const std::string current = modelGraphFingerprint(expectedGraph);
        if (stored != current)
        {
            throw std::runtime_error(
                "readCheckpointArchive: model graph fingerprint mismatch. (checkpoint=" +
                stored + ", current=" + current + ")");
        }
    }
    else
    {
        std::cerr << "[warn] checkpoint に fingerprint がありません（旧形式）。構造チェックをスキップします\n";
    }

    // Optimizer 種別の照合。Adam の状態を SGD に読ませるといった取り違えを、
    // libtorch の Optimizer::load に渡す前に弾く。
    c10::IValue optimizerTypeIValue;
    if (archive.try_read("optimizer_type", optimizerTypeIValue))
    {
        const std::string stored = optimizerTypeIValue.toStringRef();
        const std::string current = optimizerTypeName(optimizer.type());
        if (stored != current)
        {
            throw std::runtime_error(
                "readCheckpointArchive: optimizer type mismatch. (checkpoint=" +
                stored + ", current=" + current + ")");
        }
    }
    else
    {
        std::cerr << "[warn] checkpoint に optimizer 種別がありません（旧形式）。種別チェックをスキップします\n";
    }

    torch::serialize::InputArchive modelArchive;
    archive.read("model", modelArchive);
    TorchCheckpointReader modelReader(modelArchive);
    model.readFrom(modelReader);

    torch::serialize::InputArchive optimArchive;
    archive.read("optimizer", optimArchive);
    TorchCheckpointReader optimReader(optimArchive);
    optimizer.readFrom(optimReader);

    at::Tensor epochTensor;
    archive.read("epoch", epochTensor);
    at::Tensor bestMetricTensor;
    archive.read("best_metric", bestMetricTensor);

    return CheckpointMeta{
        static_cast<unsigned int>(epochTensor.item<int64_t>()),
        bestMetricTensor.item<double>()};
}

bool restoreCpuRngStateIfPresent(torch::serialize::InputArchive &archive)
{
    at::Tensor rngState;
    if (!archive.try_read("rng_state_cpu", rngState))
    {
        std::cerr << "[warn] checkpoint に rng_state_cpu がありません（旧形式）。"
                     "乱数状態は復元されません（学習再開の再現性に影響しうる）\n";
        return false;
    }
    applyCpuRngState(rngState);
    return true;
}

ModelGraph readModelGraphFromCheckpoint(torch::serialize::InputArchive &archive)
{
    torch::serialize::InputArchive graphArchive;
    if (!archive.try_read("model_graph", graphArchive))
    {
        throw std::runtime_error(
            "readModelGraphFromCheckpoint: この checkpoint はモデル構造(model_graph)を"
            "含んでいません。構造を書き出すようになる前の .pt からは再構築できません。");
    }
    return readModelGraph(graphArchive);
}
