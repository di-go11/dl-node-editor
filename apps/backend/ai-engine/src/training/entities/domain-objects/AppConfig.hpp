#pragma once

#include "OptimizerConfig.hpp"
#include "ActivationConfig.hpp"
#include <cstddef>
#include <string>

struct AppConfig
{
    std::string modelName;
    OptimizerConfig optimizer;
    ActivationConfig activation;
    std::string datasetPath; // 学習用画像・アノテーション画像が置かれているデータセットのルートディレクトリ
    unsigned int epochSize = 1;
    unsigned int batchSize = 1;
    size_t input_width = 256;
    size_t input_height = 256;
};