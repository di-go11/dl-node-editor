#pragma once

#include "OptimizerConfig.hpp"
#include "ActivationConfig.hpp"
#include <string>

struct AppConfig
{
    OptimizerConfig optimizer;
    ActivationConfig activation;
    std::string datasetPath; // 学習用画像・アノテーション画像が置かれているデータセットのルートディレクトリ
};