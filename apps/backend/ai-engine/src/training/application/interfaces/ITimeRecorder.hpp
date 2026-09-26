#pragma once

#include "training/entities/domain-objects/ProcessTimeSpan.hpp"

#include <vector>

class ITimeRecorder
{
public:
    virtual ~ITimeRecorder() = default;

    virtual void record(const ProcessTimeSpan &timeSpan) = 0;
};