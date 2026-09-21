#pragma once

#include "training/entities/domain-objects/ImageAnnotationConfig.hpp"
#include "training/entities/domain-objects/DatasetType.hpp"

#include <string>
#include <variant>

// データセットのアノテーション設定。モダリティごとの Config(variant)を並べる。
// split(train/val)は生成のたびに変わる値なので、ここには持たせず、Dataset 生成時の引数で渡す。
using DatasetAnnotationConfig = std::variant<ImageAnnotationConfig>;

inline DatasetType datasetTypeOf(const DatasetAnnotationConfig &config)
{
    return std::visit(
        [](const auto &c) -> DatasetType
        { return annotationTypeOf(c); },
        config);
}

struct DatasetConfig
{
    std::string datasetPath; // 学習用画像・アノテーション画像が置かれているデータセットのルートディレクトリ
    DatasetAnnotationConfig annotationConfig;
};