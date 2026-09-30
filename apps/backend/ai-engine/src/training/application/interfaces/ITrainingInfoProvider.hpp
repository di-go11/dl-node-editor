#pragma once

#include "training/entities/domain-objects/EpochReport.hpp"
#include "training/entities/domain-objects/TrainingStatus.hpp"

#include <cstdint>
#include <string>

// 学習ジョブの、ある時点の状態。gRPC(StreamProgress)が読み出して送る。
struct TrainingProcessSnapshot
{
    TrainingStatus status = TrainingStatus::Running;
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
};
