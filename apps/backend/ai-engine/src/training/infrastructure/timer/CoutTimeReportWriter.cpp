#include "CoutTimeReportWriter.hpp"

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <iomanip>
#include <iostream>
#include <map>
#include <sstream>
#include <string>

namespace
{
    // 名前ごとの集計値。1ms 未満の区間が 0 に切り捨てられないよう、マイクロ秒で保持する。
    struct Stat
    {
        std::size_t count = 0;
        std::chrono::microseconds total{0};
        std::chrono::microseconds min = std::chrono::microseconds::max();
        std::chrono::microseconds max{0};
    };

    double toMilliseconds(std::chrono::microseconds duration)
    {
        return static_cast<double>(duration.count()) / 1000.0;
    }
} // namespace

// 記録を名前ごとに集計し、表として標準出力に出す。
// 書式(std::fixed など)を std::cout に残さないよう、いったん文字列ストリームに組み立ててから出力する。
void CoutTimeReportWriter::writeReport(const std::vector<ProcessTimeSpan> &timeSpans)
{
    std::map<std::string, Stat> statsByName; // 名前順に並ぶ
    std::size_t nameWidth = std::string("Name").size();

    for (const auto &timeSpan : timeSpans)
    {
        const auto duration = std::chrono::duration_cast<std::chrono::microseconds>(timeSpan.endTime - timeSpan.startTime);

        Stat &stat = statsByName[timeSpan.name];
        ++stat.count;
        stat.total += duration;
        stat.min = std::min(stat.min, duration);
        stat.max = std::max(stat.max, duration);

        nameWidth = std::max(nameWidth, timeSpan.name.size());
    }

    std::ostringstream report;
    report << std::fixed << std::setprecision(3);
    report << "==== Time report ====\n";
    report << std::left << std::setw(static_cast<int>(nameWidth)) << "Name" << std::right
           << std::setw(8) << "Count"
           << std::setw(14) << "Total(ms)"
           << std::setw(12) << "Mean(ms)"
           << std::setw(12) << "Min(ms)"
           << std::setw(12) << "Max(ms)" << '\n';

    for (const auto &[name, stat] : statsByName)
    {
        const double totalMs = toMilliseconds(stat.total);
        report << std::left << std::setw(static_cast<int>(nameWidth)) << name << std::right
               << std::setw(8) << stat.count
               << std::setw(14) << totalMs
               << std::setw(12) << totalMs / static_cast<double>(stat.count)
               << std::setw(12) << toMilliseconds(stat.min)
               << std::setw(12) << toMilliseconds(stat.max) << '\n';
    }

    std::cout << report.str() << std::flush;
}
