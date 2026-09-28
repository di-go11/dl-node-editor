#pragma once

#include <string>
#include <chrono>
#include <thread>

struct ProcessTimeSpan
{
    std::string name;
    std::chrono::steady_clock::time_point startTime;
    std::chrono::steady_clock::time_point endTime;
    std::thread::id threadId;
};