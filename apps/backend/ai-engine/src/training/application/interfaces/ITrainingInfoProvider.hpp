#pragma once

#include "training/entities/domain-objects/EpochReport.hpp"
#include "training/entities/domain-objects/TrainingStatus.hpp"

#include <chrono>
#include <cstdint>
#include <string>

// 学習ジョブの、ある時点の状態。gRPC(StreamProgress)が読み出して送る。
struct TrainingProcessSnapshot
{
    TrainingStatus status = TrainingStatus::Idle; // ジョブを開始する(TrainingProgressStore::start)までは Idle
    bool hasEpochReport = false; // 1エポックも終わっていない間は false(latest は既定値のまま)
    EpochReport latest;          // 最後に完了したエポックの結果
    std::string errorMessage;    // status が Failed のときの原因
    uint64_t version = 0;        // 更新(エポック完了・終了)のたびに1増える。読み手はこれで新しい更新かを判断する
};

class ITrainingInfoProvider
{
public:
    virtual ~ITrainingInfoProvider() = default;
    virtual TrainingProcessSnapshot getTrainingProcessSnapshot() = 0;
    // snapshot.version が lastVersion より大きくなるまで(最大 timeout)待ち、その時点の snapshot を返す。
    // タイムアウトした場合は version が lastVersion のままの snapshot が返るので、呼び出し側は version で判断する。
    virtual TrainingProcessSnapshot waitForUpdate(uint64_t lastVersion, std::chrono::milliseconds timeout) = 0;
};
