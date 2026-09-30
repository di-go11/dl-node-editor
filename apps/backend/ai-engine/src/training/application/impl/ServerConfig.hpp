#pragma once

#include <string>
#include <cstddef>

struct ServerConfig
{
    std::string checkpointOutputDirPath = "models"; // チェックポイント(ベストモデルの重み)の保存先ディレクトリ
    size_t threadCount = 1;
    bool enableProcessTimeMeasurement = false;
};