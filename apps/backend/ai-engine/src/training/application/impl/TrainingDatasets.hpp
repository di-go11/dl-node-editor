#pragma once

#include <memory>

#include "training/application/interfaces/IDatasetRepository.hpp"

// 学習用と検証用のデータセットを1つにまとめて受け渡すためのデータ構造。
// どちらも走査カーソルを内部に持つ IDatasetRepository の実装を指す。
struct TrainingDatasets
{
    std::shared_ptr<IDatasetRepository> trainDataset;
    std::shared_ptr<IDatasetRepository> validationDataset;
};
