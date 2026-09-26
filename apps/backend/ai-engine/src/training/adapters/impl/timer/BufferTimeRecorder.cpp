#include "BufferTimeRecorder.hpp"

BufferTimeRecorder::BufferTimeRecorder(std::shared_ptr<ITimeReportWriter> reportWriter) : _reportWriter(reportWriter)
{
}

BufferTimeRecorder::~BufferTimeRecorder()
{
    // 破棄されるのは最後の所有者が手放したときで、他のスレッドは record を呼ばないため、ロックは不要。
    // デストラクタから例外を出すと std::terminate になる。計測の失敗で学習を止めないよう、ここで握りつぶす。
    try
    {
        if (_reportWriter && !_timeSpans.empty())
        {
            _reportWriter->writeReport(_timeSpans);
        }
    }
    catch (...)
    {
    }
}

void BufferTimeRecorder::record(const ProcessTimeSpan &timeSpan)
{
    std::lock_guard<std::mutex> lock(_mutex);
    _timeSpans.push_back(timeSpan);
}