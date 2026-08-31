#pragma once

#include "training/application/interfaces/IDatasetRepository.hpp"
#include "training/application/interfaces/image/IImageDecoder.hpp"
#include "training/infrastructure/image/ColorMaskLabelConverter.hpp"
#include "training/application/interfaces/image/IImagePreprocessor.hpp"

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
    // 画像用・マスク用で前処理器を分けて受け取る。
    // 幾何変換(出力サイズ・アスペクト比ポリシー)は両者で揃え、
    // 補間方法・パディング値だけを変えること(ResizePreprocessorFactory 参照)。
    VocDatasetRepository(
        const std::string &datasetRoot,
        const std::shared_ptr<IImageDecoder> &decoder,
        const std::shared_ptr<IImagePreprocessor> &imagePreProcessor,
        const std::shared_ptr<IImagePreprocessor> &maskPreProcessor,
        const std::shared_ptr<TrainParam> &trainParam);

    void reset() override;
    bool hasNext() const override;
    TrainingBatch getNextBatch() override;

private:
    static std::vector<std::string> loadImageIds(const std::string &listFilePath);

    std::string _datasetRoot;
    std::shared_ptr<IImageDecoder> _decoder;
    std::shared_ptr<IImagePreprocessor> _imagePreProcessor; // 画像用
    std::shared_ptr<IImagePreprocessor> _maskPreProcessor;  // ラベル用
    ColorMaskLabelConverter _labelConverter;
    int _batchSize;

    std::vector<std::string> _imageIds;
    size_t _currentIndex;
};
