#pragma once

#include "training/application/interfaces/ITimeRecorder.hpp"
#include "training/adapters/interfaces/ITimeReportWriter.hpp"
#include "training/entities/domain-objects/ProcessTimeSpan.hpp"

#include <memory>
#include <vector>
#include <mutex>

class BufferTimeRecorder : public ITimeRecorder
{
public:
    explicit BufferTimeRecorder(std::shared_ptr<ITimeReportWriter> reportWriter);
    ~BufferTimeRecorder() override;
    void record(const ProcessTimeSpan &timeSpan) override;

private:
    std::vector<ProcessTimeSpan> _timeSpans;
    std::shared_ptr<ITimeReportWriter> _reportWriter;
    std::mutex _mutex;
};