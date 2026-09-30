#pragma once

#include "training/application/interfaces/ITrainingProgressObserver.hpp"
#include "training/application/interfaces/ITrainingInfoProvider.hpp" // TrainingProcessSnapshot

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <mutex>

// 学習の進捗を保管するクラス。
// 書き込み側(ITrainingProgressObserver): 学習スレッド(usecase)とジョブ管理から呼ばれる。
// 読み出し側(ITrainingInfoProvider): gRPC のスレッドから呼ばれる。
// 両者は別スレッドなので、状態は mutex で守る。書き込み側は保存するだけですぐ戻る(学習を止めないため)。
class TrainingProgressStore : public ITrainingProgressObserver, public ITrainingInfoProvider
{
public:
    void start(); // ジョブ開始時に呼ぶ。状態をRunningに戻す
    void onFinished(TrainingStatus status, const std::string &errorMessage) override;
    void onEpochCompleted(const EpochReport &report) override;

    TrainingProcessSnapshot getTrainingProcessSnapshot() override;
    TrainingProcessSnapshot waitForUpdate(uint64_t lastVersion, std::chrono::milliseconds timeout) override;

private:
    std::mutex _mutex;
    std::condition_variable _cv;
    TrainingProcessSnapshot _snapshot; // 最新の EpochReport、status、errorMessage、version をまとめて持つ
};