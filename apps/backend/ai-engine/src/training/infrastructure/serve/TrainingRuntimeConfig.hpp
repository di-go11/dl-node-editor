#pragma once

#include <string>
#include <cstddef>
#include <string_view>

struct TrainingRuntimeConfig
{
    TrainingRuntimeConfig();
    std::string checkpointOutputDirPath; // チェックポイント(ベストモデルの重み)の保存先ディレクトリ
    size_t imageLoadThreadCount;
    bool enableProcessTimeMeasurement;

    bool setImageLoadThreadCount(std::string_view value);
};
