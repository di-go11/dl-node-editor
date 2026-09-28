#include "ScopedTimer.hpp"
#include "training/entities/domain-objects/ProcessTimeSpan.hpp"

#include <chrono>
#include <thread>

ScopedTimer::ScopedTimer(ITimeRecorder &timeRecorder, const std::string &name)
    : _timeRecorder(timeRecorder)
{
    // 計測開始
    _processTimeSpan.name = name;
    _processTimeSpan.startTime = std::chrono::steady_clock::now();
    _processTimeSpan.threadId = std::this_thread::get_id();
}

ScopedTimer::~ScopedTimer()
{
    // 計測終了
    _processTimeSpan.endTime = std::chrono::steady_clock::now();

    // デストラクタから例外を出すと std::terminate になる。
    // 計測の失敗(メモリ確保の失敗など)で、本来の処理を止めないよう、ここで握りつぶす。
    try
    {
        _timeRecorder.record(_processTimeSpan);
    }
    catch (...)
    {
    }
}
