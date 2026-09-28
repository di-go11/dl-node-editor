#pragma once

#include "training/entities/domain-objects/ProcessTimeSpan.hpp"
#include <vector>

class ITimeReportWriter
{
public:
    virtual ~ITimeReportWriter() = default;

    virtual void writeReport(const std::vector<ProcessTimeSpan> &timeSpans) = 0;
};