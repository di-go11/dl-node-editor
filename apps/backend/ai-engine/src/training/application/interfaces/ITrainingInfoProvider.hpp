#pragma once

#include "training/entities/domain-objects/EpochReport.hpp"
#include "training/entities/domain-objects/TrainingStatus.hpp"

#include <chrono>
#include <cstdint>
#include <string>
#include <vector>

// 学習ジョブの、ある時点の状態。gRPC(StreamProgress)が読み出して送る。
struct TrainingProcessSnapshot
{
    TrainingStatus status = TrainingStatus::Idle; // ジョブを開始する(TrainingProgressStore::start)までは Idle
    bool hasEpochReport = false;                  // 1エポックも終わっていない間は false(latest は既定値のまま)
    EpochReport latest;                           // 最後に完了したエポックの結果
    std::string errorMessage;                     // status が Failed のときの原因
    uint64_t version = 0;                         // 更新(エポック完了・終了)のたびに1増える。読み手はこれで新しい更新かを判断する
};

struct EpochBatch
{
    std::vector<EpochReport> reports; // 1エポックごとの結果をまとめて返すときに使う
    TrainingStatus status = TrainingStatus::Idle;
    std::string errorMessage; // status が Failed のときの原因
    uint64_t version = 0;     // 更新(エポック完了・終了)のたびに1増える。読み手はこれで新しい更新かを判断する
};

class ITrainingInfoProvider
{
public:
    virtual ~ITrainingInfoProvider() = default;
    virtual TrainingProcessSnapshot getTrainingProcessSnapshot() = 0;
    // snapshot.version が lastVersion より大きくなるまで(最大 timeout)待ち、その時点の snapshot を返す。
    // タイムアウトした場合は version が lastVersion のままの snapshot が返るので、呼び出し側は version で判断する。
    virtual TrainingProcessSnapshot waitForUpdate(uint64_t lastVersion, std::chrono::milliseconds timeout) = 0;
    // versionがlastVersionより大きくなるまで(最大timeout)まち
    // afterEpochより後のエポックとその時点の状態を返す。
    // afterEpoch は完了したエポック数(response.epoch と同じ数え方)。EpochReport.epoch は 0 始まりなので 1 ずれる。
    virtual EpochBatch waitForEpochsAfter(unsigned int afterEpoch, uint64_t lastVersion, std::chrono::milliseconds timeout) = 0;
};
