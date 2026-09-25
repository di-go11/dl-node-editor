#pragma once

#include "training/entities/domain-objects/DatasetSplit.hpp"

#include "training/application/interfaces/image/IImageDecoder.hpp"
#include "training/infrastructure/image/ColorMaskLabelConverter.hpp"

#include "training/infrastructure/dataset/interfaces/ISegmentationData.hpp"

#include <memory>
#include <vector>
#include <string>

class LabelMapFileReader;

// PASCAL VOC形式のセグメンテーションデータセットを読み込むISegmentationData実装。
// 前提とするディレクトリ構成:
//   datasetRoot/JPEGImages/{id}.jpg                 学習用画像
//   datasetRoot/SegmentationClassP/{id}.png          カラーコード化されたアノテーション画像
//   datasetRoot/ImageSets/Segmentation/train.txt    使用する画像IDの一覧(1行1ID)
class VocSegmentationData : public ISegmentationData
{
public:
    VocSegmentationData(const std::string &datasetRoot,
                        const std::shared_ptr<IImageDecoder> &decoder,
                        const std::shared_ptr<LabelMapFileReader> &labelMapReader,
                        DatasetSplit split);

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