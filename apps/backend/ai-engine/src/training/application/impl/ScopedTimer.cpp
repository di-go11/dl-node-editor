#include "ScopedTimer.hpp"
#include "training/entities/domain-objects/ProcessTimeSpan.hpp"

#include <chrono>
#include <thread>

ScopedTimer::ScopedTimer(ITimeRecorder &timeRecorder, const std::string &name)
    : _timeRecorder(timeRecorder), _name(name)
{
    // 計測開始
    _processTimeSpan.name = _name;
    _processTimeSpan.startTime = std::chrono::steady_clock::now();
    _processTimeSpan.threadId = std::this_thread::get_id();
}

ScopedTimer::~ScopedTimer()
{
    // 計測終了
    _processTimeSpan.endTime = std::chrono::steady_clock::now();
    _timeRecorder.record(_processTimeSpan);
}