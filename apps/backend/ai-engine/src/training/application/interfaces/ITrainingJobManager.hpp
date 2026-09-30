#pragma once

#include "training/application/impl/StartTrainingCommand.hpp"
#include "training/application/interfaces/ITrainingInfoProvider.hpp"
#include "training/entities/domain-objects/TrainingStatus.hpp"

#include <memory>
#include <stdexcept>
#include <string>

// 別のジョブが実行中のため、新しいジョブを開始できない(GPU を奪い合わないよう、同時に1ジョブまで)。
class TrainingJobBusyError : public std::runtime_error
{
public:
    using std::runtime_error::runtime_error;
};

// 指定された job_id のジョブが存在しない。
class TrainingJobNotFoundError : public std::runtime_error
{
public:
    using std::runtime_error::runtime_error;
};

// 学習ジョブの開始・停止・進捗の取得。gRPC の TrainingService から使う。
class ITrainingJobManager
{
public:
    virtual ~ITrainingJobManager() = default;

    // ジョブを別スレッドで開始し、job_id を返す。戻った時点で状態は Running。
    // 実行中のジョブがあれば TrainingJobBusyError。
    virtual std::string start(const StartTrainingCommand &command) = 0;

    // 停止を要求し、その時点の状態を返す。停止はエポックの区切りで行われるため、直後はまだ Running のことがある。
    // job_id が存在しなければ TrainingJobNotFoundError。
    virtual TrainingStatus requestStop(const std::string &jobId) = 0;

    // ジョブの進捗の読み出し口。終了したジョブも読める。
    // job_id が存在しなければ TrainingJobNotFoundError。
    virtual std::shared_ptr<ITrainingInfoProvider> progress(const std::string &jobId) = 0;
};
