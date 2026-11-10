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
        check(s.status == TrainingStatus::Idle, "初期状態: status == Idle(ジョブ開始前)");
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

    // ---------- waitForEpochsAfter: afterEpoch は完了したエポック数(EpochReport.epoch は 0 始まり) ----------
    {
        TrainingProgressStore history;
        history.start();
        history.onEpochCompleted(makeReport(0, 0.9));
        history.onEpochCompleted(makeReport(1, 0.8));
        history.onEpochCompleted(makeReport(2, 0.7));

        const EpochBatch all = history.waitForEpochsAfter(/*afterEpoch=*/0, /*lastVersion=*/0, 5s);
        check(all.reports.size() == 3 && all.reports[0].epoch == 0, "waitForEpochsAfter(0): 最初のエポックから全部返す");
        check(all.status == TrainingStatus::Running, "waitForEpochsAfter: その時点の状態を返す");
        check(all.version == 4, "waitForEpochsAfter: その時点の version を返す");

        const EpochBatch rest = history.waitForEpochsAfter(/*afterEpoch=*/2, /*lastVersion=*/0, 5s);
        check(rest.reports.size() == 1 && rest.reports[0].epoch == 2, "waitForEpochsAfter(2): 3 番目のエポックだけ返す");

        const EpochBatch none = history.waitForEpochsAfter(/*afterEpoch=*/3, /*lastVersion=*/0, 5s);
        check(none.reports.empty(), "waitForEpochsAfter(3): 続きがなければ空");
    }

    // ---------- waitForEpochsAfter: 1 件ずつ読み進めても抜けない ----------
    {
        TrainingProgressStore history;
        history.start();
        unsigned int cursor = 0;
        uint64_t lastVersion = 0;
        unsigned int received = 0;
        for (unsigned int epoch = 0; epoch < 5; ++epoch)
        {
            history.onEpochCompleted(makeReport(epoch, 0.5));
            const EpochBatch batch = history.waitForEpochsAfter(cursor, lastVersion, 5s);
            lastVersion = batch.version;
            for (const EpochReport &report : batch.reports)
            {
                check(report.epoch == received, "waitForEpochsAfter(逐次): 順番どおりに届く");
                ++received;
                cursor = report.epoch + 1u;
            }
        }
        check(received == 5, "waitForEpochsAfter(逐次): 全エポックが届く");
    }

    // ---------- waitForEpochsAfter: 終了後に読んでも全部返る ----------
    {
        TrainingProgressStore history;
        history.start();
        history.onEpochCompleted(makeReport(0, 0.9));
        history.onEpochCompleted(makeReport(1, 0.8));
        history.onFinished(TrainingStatus::Completed, "");

        const EpochBatch batch = history.waitForEpochsAfter(/*afterEpoch=*/0, /*lastVersion=*/0, 5s);
        check(batch.reports.size() == 2, "waitForEpochsAfter(終了後): 全エポックが返る");
        check(batch.status == TrainingStatus::Completed, "waitForEpochsAfter(終了後): 終了の状態が返る");
    }

    // ---------- waitForEpochsAfter: 1 エポックも終わらずに失敗 ----------
    {
        TrainingProgressStore history;
        history.start();
        history.onFinished(TrainingStatus::Failed, "dataset not found");

        const EpochBatch batch = history.waitForEpochsAfter(/*afterEpoch=*/0, /*lastVersion=*/0, 5s);
        check(batch.reports.empty(), "waitForEpochsAfter(即失敗): エポックは空");
        check(batch.status == TrainingStatus::Failed, "waitForEpochsAfter(即失敗): status == Failed");
        check(batch.errorMessage == "dataset not found", "waitForEpochsAfter(即失敗): errorMessage が入る");
    }

    // ---------- waitForEpochsAfter: 更新がなければタイムアウトする ----------
    {
        TrainingProgressStore history;
        history.start();
        const auto begin = std::chrono::steady_clock::now();
        const EpochBatch batch = history.waitForEpochsAfter(/*afterEpoch=*/0, /*lastVersion=*/1, 50ms);
        const auto elapsed = std::chrono::steady_clock::now() - begin;
        check(batch.version == 1, "waitForEpochsAfter(timeout): version は変わらない");
        check(elapsed >= 50ms, "waitForEpochsAfter(timeout): timeout まで待つ");
    }

    // ---------- start で履歴が消える ----------
    {
        TrainingProgressStore history;
        history.start();
        history.onEpochCompleted(makeReport(0, 0.9));
        history.start();
        const EpochBatch batch = history.waitForEpochsAfter(/*afterEpoch=*/0, /*lastVersion=*/0, 5s);
        check(batch.reports.empty(), "再 start: 前のジョブの履歴は消える");
    }

    if (failureCount == 0)
    {
        std::cout << "All training progress store tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}
