#pragma once

#include "training/entities/domain-objects/DatasetSplit.hpp"

#include "training/application/interfaces/image/IImageDecoder.hpp"
#include "training/entities/image/ColorLabelMap.hpp"
#include "training/infrastructure/image/ColorMaskLabelConverter.hpp"

#include "training/infrastructure/dataset/interfaces/ISegmentationData.hpp"

#include <cstdint>
#include <memory>
#include <optional>
#include <vector>
#include <string>

// PASCAL VOC と同じディレクトリ構成のセグメンテーションデータセットを読み込むISegmentationData実装。
// 形式(pascal_voc / original)の違いは色表(labelMap)だけなので、どちらもこのクラスで読む。
// 前提とするディレクトリ構成:
//   datasetRoot/JPEGImages/{id}.jpg                 学習用画像
//   datasetRoot/SegmentationClass/{id}.png          アノテーション画像(パレット PNG でも RGB でもよい。色として読む)
//   datasetRoot/ImageSets/Segmentation/train.txt    使用する画像IDの一覧(1行1ID)
class VocSegmentationData : public ISegmentationData
{
public:
    // labelMap: マスクの色とクラス ID の対応(形式ごとの作り方は loadDatasetLabelMap を参照)。
    // ignoreIndex / ignoreColor: マスク中の ignoreColor の画素を ignoreIndex に変換する
    // (ColorMaskLabelConverter を参照)。ignoreColor が nullopt なら、labelMap にない色はエラー。
    VocSegmentationData(const std::string &datasetRoot,
                        const std::shared_ptr<IImageDecoder> &decoder,
                        const ColorLabelMap &labelMap,
                        DatasetSplit split,
                        uint8_t ignoreIndex = 255,
                        std::optional<RgbColor> ignoreColor = std::nullopt);

    size_t size() const override;
    ImageData getImage(size_t index) const override;
    ImageData getMask(size_t index) const override;

private:
    static std::vector<std::string> loadImageIds(const std::string &listFilePath);

    std::string _datasetRoot;
    std::shared_ptr<IImageDecoder> _decoder;
    ColorMaskLabelConverter _labelConverter;
    std::vector<std::string> _imageIds;
};