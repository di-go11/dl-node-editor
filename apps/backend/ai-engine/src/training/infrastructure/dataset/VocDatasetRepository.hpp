#pragma once

#include "training/application/interfaces/IDatasetRepository.hpp"
#include "training/application/interfaces/IImageDecoder.hpp"
#include "training/infrastructure/dataset/ColorMaskLabelConverter.hpp"

#include <memory>
#include <string>
#include <vector>

class TrainParam;

// PASCAL VOC形式のセグメンテーションデータセットを読み込むIDatasetRepository実装。
// 前提とするディレクトリ構成:
//   datasetRoot/JPEGImages/{id}.jpg                 学習用画像
//   datasetRoot/SegmentationClass/{id}.png          カラーコード化されたアノテーション画像
//   datasetRoot/ImageSets/Segmentation/train.txt    使用する画像IDの一覧(1行1ID)
class VocDatasetRepository : public IDatasetRepository
{
public:
    // バッチ数はtrainParam.getBatchSize()から取得する(.config、将来的にはGUI入力が単一の参照元)
    VocDatasetRepository(
        const std::string &datasetRoot,
        const std::shared_ptr<IImageDecoder> &decoder,
        const std::shared_ptr<TrainParam> &trainParam);

    BatchData *getBatchData() override;
    void reset() override;
    bool hasNext() const override;
    TrainingBatch getNextBatch() override;

private:
    static std::vector<std::string> loadImageIds(const std::string &listFilePath);

    std::string _datasetRoot;
    std::shared_ptr<IImageDecoder> _decoder;
    ColorMaskLabelConverter _labelConverter;
    int _batchSize;

    std::vector<std::string> _imageIds;
    size_t _currentIndex;
};
