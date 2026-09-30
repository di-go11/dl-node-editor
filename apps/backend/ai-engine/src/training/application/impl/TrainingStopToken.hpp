#pragma once

#include <atomic>

// 学習の停止要求を伝えるフラグ。
// 停止を要求する側(gRPC の StopTraining)と、確認する側(学習スレッドの TrainModelUsecase)が
// 別スレッドなので atomic にしている。usecase はエポックの区切りごとに確認する。
class TrainingStopToken
{
public:
    void requestStop() { _stopRequested.store(true); }
    bool isStopRequested() const { return _stopRequested.load(); }

private:
    std::atomic<bool> _stopRequested{false};
};
