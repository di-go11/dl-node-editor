// TrainModelUsecaseが学習過程(EpochMetrics)のオブジェクトに書き込むたびに発火してgRPCに伝える。
#pragma once

#include "training/entities/domain-objects/TrainingStatus.hpp"
#include "training/entities/domain-objects/EpochReport.hpp"

#include <string>

class ITrainingProgressObserver
{
public:
    virtual ~ITrainingProgressObserver() = default;
    virtual void onFinished(TrainingStatus status, const std::string &errorMessage) = 0;
    virtual void onEpochCompleted(const EpochReport &report) = 0;
};