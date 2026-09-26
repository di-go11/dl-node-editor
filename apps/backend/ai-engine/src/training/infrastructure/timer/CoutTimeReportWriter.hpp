// 標準出力で処理時間を名前ごとに出力するクラス

#pragma once
#include "training/adapters/interfaces/ITimeReportWriter.hpp"
#include "training/entities/domain-objects/ProcessTimeSpan.hpp"

#include <vector>

class CoutTimeReportWriter : public ITimeReportWriter
{
public:
    void writeReport(const std::vector<ProcessTimeSpan> &timeSpans) override;
};