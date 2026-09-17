#pragma once

#include "OptimizerConfig.hpp"
#include "ActivationConfig.hpp"
#include "ComputeDevice.hpp"
#include "ModelArchitectureType.hpp"
#include <cstddef>
#include <string>

struct AppConfig
{
    std::string modelName;
    OptimizerConfig optimizer;
    ActivationConfig activation;
    std::string datasetPath;          // 学習用画像・アノテーション画像が置かれているデータセットのルートディレクトリ
    std::string outputDir = "models"; // チェックポイント(ベストモデルの重み)の保存先ディレクトリ

    // 学習再開(resume)の設定。
    // resumeFrom: 再開元の .pt を明示指定する。空なら outputDir の
    //             <modelName>_last.pt があれば自動で再開、なければ cold start。
    std::string resumeFrom;
    // saveLastEvery: 「直近」チェックポイントを何エポックごとに書くか(0 = 毎エポック)。
    //                I/O 負荷と、中断時に失う進捗のトレードオフ。
    unsigned int saveLastEvery = 0;

    unsigned int epochSize = 1;
    unsigned int batchSize = 1;
    size_t input_width = 256;
    size_t input_height = 256;

    // 学習に使用するデバイスの設定 (デフォルトは CUDA 0)
    ComputeDevice device = ComputeDevice{ComputeDeviceType::Cuda, 0};

    // 学習するモデル構造。TrainingApp.cpp の buildXxxGraph() の選択に使う。
    ModelArchitectureType architecture = ModelArchitectureType::Sample;
};