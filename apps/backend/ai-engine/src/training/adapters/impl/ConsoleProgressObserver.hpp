#pragma once

#include "training/application/interfaces/ITrainingProgressObserver.hpp"

// 学習の進捗を標準出力に書く Observer。CLI(TrainingApp)で使う。
class ConsoleProgressObserver : public ITrainingProgressObserver
{
public:
    void onEpochCompleted(const EpochReport &report) override;
    void onFinished(TrainingStatus status, const std::string &errorMessage) override;
};
