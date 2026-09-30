#include "ConsoleProgressObserver.hpp"

#include "training/entities/domain-objects/Metrics/MonitoredMetric.hpp"

#include <iostream>

namespace
{
    const char *statusName(TrainingStatus status)
    {
        switch (status)
        {
        case TrainingStatus::Idle:
            return "Idle";
        case TrainingStatus::Running:
            return "Running";
        case TrainingStatus::Completed:
            return "Completed";
        case TrainingStatus::Failed:
            return "Failed";
        case TrainingStatus::Stopped:
            return "Stopped";
        }
        return "Unknown";
    }
}

void ConsoleProgressObserver::onEpochCompleted(const EpochReport &report)
{
    std::cout << "epoch " << report.epoch
              << " | train_loss=" << report.trainLoss
              << " | val_loss=" << report.validation.loss
              << " | val " << describe(report.validation.taskMetrics)
              << " | " << report.epochElapsedMs << "ms"
              << std::endl;
}

void ConsoleProgressObserver::onFinished(TrainingStatus status, const std::string &errorMessage)
{
    std::cout << "training finished: " << statusName(status);
    if (!errorMessage.empty())
    {
        std::cout << " (" << errorMessage << ")";
    }
    std::cout << std::endl;
}
