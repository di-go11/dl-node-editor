#include "CoutTimeReportWriter.hpp"

#include <iostream>
#include <chrono>

void CoutTimeReportWriter::writeReport(const std::vector<ProcessTimeSpan> &timeSpans)
{
    for (const auto &timeSpan : timeSpans)
    {
        auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(timeSpan.endTime - timeSpan.startTime).count();
        std::cout << "Name: " << timeSpan.name
                  << ", Duration: " << duration << " ms"
                  << ", Thread ID: " << timeSpan.threadId
                  << std::endl;
    }
}