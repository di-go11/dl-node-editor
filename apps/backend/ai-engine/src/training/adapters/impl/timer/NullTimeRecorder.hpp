#pragma once

#include "training/application/interfaces/ITimeRecorder.hpp"
#include "training/entities/domain-objects/ProcessTimeSpan.hpp"

class NullTimeRecorder : public ITimeRecorder
{
public:
    void record(const ProcessTimeSpan &timeSpan) override;
};