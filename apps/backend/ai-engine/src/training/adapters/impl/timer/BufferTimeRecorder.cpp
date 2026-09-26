#include "BufferTimeRecorder.hpp"

BufferTimeRecorder::BufferTimeRecorder(std::shared_ptr<ITimeReportWriter> reportWriter) : _reportWriter(reportWriter)
{
}

BufferTimeRecorder::~BufferTimeRecorder()
{
    std::lock_guard<std::mutex> lock(_mutex);
    if (!_timeSpans.empty())
    {
        _reportWriter->writeReport(_timeSpans);
    }
}

void BufferTimeRecorder::record(const ProcessTimeSpan &timeSpan)
{
    std::lock_guard<std::mutex> lock(_mutex);
    _timeSpans.push_back(timeSpan);
}