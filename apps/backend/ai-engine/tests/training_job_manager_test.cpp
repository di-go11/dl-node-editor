// TrainingJobManager(学習ジョブの開始・停止・同時実行の制限)の単体テスト。
// 学習の実行(runner)は偽物に差し替え、libtorch を動かさずにジョブ管理だけを確かめる。

#include "training/adapters/impl/TrainingJobManager.hpp"
#include "training/application/impl/TrainingStopToken.hpp"

#include <atomic>
#include <chrono>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>

namespace
{
int failureCount = 0;

void check(bool condition, const std::string &message)
{
    std::cout << (condition ? "[PASS] " : "[FAIL] ") << message << std::endl;
    if (!condition)
    {
        ++failureCount;
    }
}

using namespace std::chrono_literals;

// 状態が終了(Completed / Failed / Stopped)になるまで待つ。
TrainingProcessSnapshot waitUntilFinished(ITrainingJobManager &manager, const std::string &jobId)
{
    auto progress = manager.progress(jobId);
    TrainingProcessSnapshot s = progress->getTrainingProcessSnapshot();
    const auto deadline = std::chrono::steady_clock::now() + 5s;
    while (s.status == TrainingStatus::Running && std::chrono::steady_clock::now() < deadline)
    {
        s = progress->waitForUpdate(s.version, 100ms);
    }
    return s;
}

// 停止要求が来るまでエポックを回し続ける runner(学習中のジョブを模す)。
TrainingJobManager::JobRunner runUntilStopped(std::atomic<int> &epochs)
{
    return [&epochs](const StartTrainingCommand &, const std::shared_ptr<ITrainingProgressObserver> &observer,
                     const TrainingStopToken *stopToken)
    {
        const auto deadline = std::chrono::steady_clock::now() + 5s;
        while (!stopToken->isStopRequested() && std::chrono::steady_clock::now() < deadline)
        {
            EpochReport report;
            report.epoch = static_cast<unsigned int>(epochs++);
            observer->onEpochCompleted(report);
            std::this_thread::sleep_for(10ms);
        }
        return TrainingStatus::Stopped;
    };
}
} // namespace

int main()
{
    // ---------- 正常終了 ----------
    {
        TrainingJobManager manager(
            [](const StartTrainingCommand &, const std::shared_ptr<ITrainingProgressObserver> &observer,
               const TrainingStopToken *)
            {
                EpochReport report;
                report.epoch = 0;
                report.trainLoss = 0.7;
                observer->onEpochCompleted(report);
                return TrainingStatus::Completed;
            });

        const std::string jobId = manager.start(StartTrainingCommand{});
        check(!jobId.empty(), "開始: job_id が返る");

        const TrainingProcessSnapshot s = waitUntilFinished(manager, jobId);
        check(s.status == TrainingStatus::Completed, "正常終了: status == Completed");
        check(s.hasEpochReport && s.latest.trainLoss == 0.7, "正常終了: エポックの結果が Store に届いている");
        check(s.errorMessage.empty(), "正常終了: errorMessage は空");

        // 終了したジョブの後なら、次のジョブを開始できる
        const std::string nextJobId = manager.start(StartTrainingCommand{});
        check(nextJobId != jobId, "次のジョブ: 別の job_id が返る");
        waitUntilFinished(manager, nextJobId);
        check(manager.progress(jobId)->getTrainingProcessSnapshot().status == TrainingStatus::Completed,
              "終了したジョブの進捗も読める");
    }

    // ---------- 失敗(runner が例外を投げる) ----------
    {
        TrainingJobManager manager(
            [](const StartTrainingCommand &, const std::shared_ptr<ITrainingProgressObserver> &, const TrainingStopToken *)
                -> TrainingStatus
            { throw std::runtime_error("dataset not found"); });

        const std::string jobId = manager.start(StartTrainingCommand{});
        const TrainingProcessSnapshot s = waitUntilFinished(manager, jobId);
        check(s.status == TrainingStatus::Failed, "失敗: status == Failed");
        check(s.errorMessage == "dataset not found", "失敗: 例外のメッセージが errorMessage に入る");
    }

    // ---------- 同時実行の制限と停止 ----------
    {
        std::atomic<int> epochs{0};
        TrainingJobManager manager(runUntilStopped(epochs));

        const std::string jobId = manager.start(StartTrainingCommand{});
        check(manager.progress(jobId)->getTrainingProcessSnapshot().status == TrainingStatus::Running,
              "開始: 戻った時点で status == Running");

        bool busy = false;
        try
        {
            manager.start(StartTrainingCommand{});
        }
        catch (const TrainingJobBusyError &)
        {
            busy = true;
        }
        check(busy, "同時実行: 実行中は次のジョブを開始できない(TrainingJobBusyError)");

        std::this_thread::sleep_for(50ms); // 何エポックか回す
        manager.requestStop(jobId);
        const TrainingProcessSnapshot s = waitUntilFinished(manager, jobId);
        check(s.status == TrainingStatus::Stopped, "停止: 停止要求が runner に届き、status == Stopped");
        check(epochs.load() > 0, "停止: 停止前にエポックが回っている");
    }

    // ---------- 存在しない job_id ----------
    {
        TrainingJobManager manager(
            [](const StartTrainingCommand &, const std::shared_ptr<ITrainingProgressObserver> &, const TrainingStopToken *)
            { return TrainingStatus::Completed; });

        bool progressNotFound = false;
        bool stopNotFound = false;
        try
        {
            manager.progress("job-999");
        }
        catch (const TrainingJobNotFoundError &)
        {
            progressNotFound = true;
        }
        try
        {
            manager.requestStop("job-999");
        }
        catch (const TrainingJobNotFoundError &)
        {
            stopNotFound = true;
        }
        check(progressNotFound, "存在しない job_id: progress は TrainingJobNotFoundError");
        check(stopNotFound, "存在しない job_id: requestStop は TrainingJobNotFoundError");
    }

    // ---------- 実行中に manager を破棄しても、停止してスレッドを待つ ----------
    {
        std::atomic<int> epochs{0};
        const auto begin = std::chrono::steady_clock::now();
        {
            TrainingJobManager manager(runUntilStopped(epochs));
            manager.start(StartTrainingCommand{});
            std::this_thread::sleep_for(30ms);
        } // デストラクタで停止要求 + join
        check(std::chrono::steady_clock::now() - begin < 2s, "破棄: 実行中のジョブを止めてから破棄される(ハングしない)");
    }

    if (failureCount == 0)
    {
        std::cout << "All training job manager tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
