#pragma once
#include <string>
#include "training/application/impl/ServerConfig.hpp"
#include "training/application/impl/StartTrainingCommand.hpp"
#include "training/entities/domain-objects/ModelArchitectureType.hpp"

// .config の読み取り結果。1ファイルにサーバー設定とジョブの依頼が同居しているため、両方を返す。
struct TrainingConfigFile
{
    ServerConfig server;
    // modelGraph は空のまま。CLI では architecture とクラス数から組み立てる(TrainingApp)。
    StartTrainingCommand command;
    // CLI 専用。GUI(gRPC)からは ModelGraph そのものが届くため使わない。
    ModelArchitectureType architecture = ModelArchitectureType::Sample;
};

class ConfigReader
{
public:
    ConfigReader();
    TrainingConfigFile readAll(const std::string &filePath);

private:
    std::string trim(const std::string &str);
};