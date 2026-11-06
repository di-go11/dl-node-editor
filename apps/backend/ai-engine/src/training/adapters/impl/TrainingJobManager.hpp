#pragma once

#include "training/application/interfaces/ITrainingJobManager.hpp"
#include "training/application/interfaces/ITrainingProgressObserver.hpp"

#include <atomic>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

class TrainingProgressStore;
class TrainingStopToken;

// ITrainingJobManager の実装。ジョブごとに TrainingProgressStore と TrainingStopToken を用意し、
// 学習を別スレッドで実行する。GPU を奪い合わないよう、同時に実行できるのは1ジョブまで。
//
// 学習の実行そのもの(runTrainingJob)は JobRunner として注入する。
// これにより、このクラスは libtorch に依存せず、テストでは偽物の runner に差し替えられる。
class TrainingJobManager : public ITrainingJobManager
{
public:
    // 戻り値は Completed / Stopped。失敗は例外で返す(runTrainingJob と同じ約束)。
    using JobRunner = std::function<TrainingStatus(const StartTrainingCommand &command,
                                                   const std::shared_ptr<ITrainingProgressObserver> &progressObserver,
                                                   const TrainingStopToken *stopToken)>;

    // 学習スレッドを起動する前に、同じスレッドで依頼を検査する。開始できなければ例外を投げる
    // (TrainingPreconditionError など)。投げた例外は start からそのまま呼び出し側へ返り、ジョブは作られない。
    // runner の中で失敗すると Failed として進捗に入るだけなので、gRPC の応答で返したい検査はこちらに置く。
    using JobPreflight = std::function<void(const StartTrainingCommand &command)>;

    // preflight は省略可(空なら検査しない)。
    explicit TrainingJobManager(JobRunner runner, JobPreflight preflight = {});
    // 実行中のジョブがあれば停止を要求し、スレッドの終了を待つ。
    ~TrainingJobManager() override;

    TrainingJobManager(const TrainingJobManager &) = delete;
    TrainingJobManager &operator=(const TrainingJobManager &) = delete;

    std::string start(const StartTrainingCommand &command) override;
    TrainingStatus requestStop(const std::string &jobId) override;
    std::shared_ptr<ITrainingInfoProvider> progress(const std::string &jobId) override;

private:
    struct Job
    {
        std::shared_ptr<TrainingProgressStore> store;
        std::shared_ptr<TrainingStopToken> stopToken;
        std::thread thread;
        std::shared_ptr<std::atomic<bool>> finished; // スレッドが onFinished まで終えたら true
    };

    // 終了済みのジョブのスレッドを join する(_mutex を持った状態で呼ぶ)。
    void joinFinishedThreadsLocked();

    JobRunner _runner;
    JobPreflight _preflight;
    std::mutex _mutex;
    std::map<std::string, Job> _jobs; // 終了したジョブも、進捗を読めるよう残しておく
    uint64_t _nextJobNumber = 1;
};
