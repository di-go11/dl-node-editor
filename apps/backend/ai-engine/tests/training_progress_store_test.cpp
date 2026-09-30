// TrainingProgressStore(学習進捗の保管)の単体テスト。
//   - start / onEpochCompleted / onFinished で snapshot と version が正しく更新される
//   - waitForUpdate が、更新がなければタイムアウトし、別スレッドから更新されれば待ちが解ける

#include "training/adapters/impl/TrainingProgressStore.hpp"

#include <chrono>
#include <iostream>
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

EpochReport makeReport(unsigned int epoch, double trainLoss)
{
    EpochReport report;
    report.epoch = epoch;
    report.trainLoss = trainLoss;
    report.validation.loss = trainLoss * 0.5;
    return report;
}
} // namespace

int main()
{
    using namespace std::chrono_literals;

    TrainingProgressStore store;

    // ---------- 初期状態 ----------
    {
        const TrainingProcessSnapshot s = store.getTrainingProcessSnapshot();
        check(s.version == 0, "初期状態: version == 0");
        check(!s.hasEpochReport, "初期状態: エポックの結果はまだない");
    }

    // ---------- start ----------
    store.start();
    {
        const TrainingProcessSnapshot s = store.getTrainingProcessSnapshot();
        check(s.status == TrainingStatus::Running, "start: status == Running");
        check(s.version == 1, "start: version が 1 進む");
    }

    // ---------- onEpochCompleted ----------
    store.onEpochCompleted(makeReport(0, 0.8));
    {
        const TrainingProcessSnapshot s = store.getTrainingProcessSnapshot();
        check(s.hasEpochReport, "onEpochCompleted: エポックの結果がある");
        check(s.latest.epoch == 0 && s.latest.trainLoss == 0.8, "onEpochCompleted: 最新の結果が入る");
        check(s.status == TrainingStatus::Running, "onEpochCompleted: status は Running のまま");
        check(s.version == 2, "onEpochCompleted: version が 1 進む");
    }

    // ---------- waitForUpdate: 更新がなければタイムアウトする ----------
    {
        const auto begin = std::chrono::steady_clock::now();
        const TrainingProcessSnapshot s = store.waitForUpdate(/*lastVersion=*/2, 50ms);
        const auto elapsed = std::chrono::steady_clock::now() - begin;
        check(s.version == 2, "waitForUpdate(timeout): version は変わらない");
        check(elapsed >= 50ms, "waitForUpdate(timeout): timeout まで待つ");
    }

    // ---------- waitForUpdate: lastVersion より新しければすぐ返る ----------
    {
        const TrainingProcessSnapshot s = store.waitForUpdate(/*lastVersion=*/1, 5s);
        check(s.version == 2, "waitForUpdate(既に新しい): 待たずに最新を返す");
    }

    // ---------- waitForUpdate: 別スレッドの更新で待ちが解ける ----------
    {
        TrainingProcessSnapshot received;
        std::thread reader([&]
                           { received = store.waitForUpdate(/*lastVersion=*/2, 5s); });
        std::this_thread::sleep_for(50ms); // reader が待ち始めるのを待つ
        const auto begin = std::chrono::steady_clock::now();
        store.onEpochCompleted(makeReport(1, 0.6));
        reader.join();
        const auto elapsed = std::chrono::steady_clock::now() - begin;
        check(received.version == 3 && received.latest.epoch == 1, "waitForUpdate(通知): 新しい結果を受け取る");
        check(elapsed < 1s, "waitForUpdate(通知): timeout を待たずに解ける");
    }

    // ---------- onFinished ----------
    store.onFinished(TrainingStatus::Failed, "dataset not found");
    {
        const TrainingProcessSnapshot s = store.getTrainingProcessSnapshot();
        check(s.status == TrainingStatus::Failed, "onFinished: status == Failed");
        check(s.errorMessage == "dataset not found", "onFinished: errorMessage が入る");
        check(s.latest.epoch == 1, "onFinished: 最後のエポックの結果は残る");
        check(s.version == 4, "onFinished: version が 1 進む");
    }

    // ---------- 次のジョブの start ----------
    store.start();
    {
        const TrainingProcessSnapshot s = store.getTrainingProcessSnapshot();
        check(s.status == TrainingStatus::Running, "再 start: status == Running");
        check(s.errorMessage.empty(), "再 start: 前のジョブの errorMessage は消える");
        check(!s.hasEpochReport, "再 start: 前のジョブのエポックの結果は消える");
        check(s.version == 5, "再 start: version は引き継いで進む(0 に戻らない)");
    }

    if (failureCount == 0)
    {
        std::cout << "All training progress store tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
