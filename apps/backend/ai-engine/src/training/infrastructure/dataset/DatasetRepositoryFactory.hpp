#pragma once

#include "training/application/interfaces/IDatasetRepositoryFactory.hpp"

#include "training/entities/domain-objects/Tasks/ImageTaskType.hpp"
#include "training/entities/domain-objects/ImageAnnotationConfig.hpp"
#include "training/entities/domain-objects/TrainParam.hpp"

#include "training/application/interfaces/image/IImageDecoder.hpp"
#include "training/infrastructure/dataset/LabelMapFileReader.hpp"
#include "training/infrastructure/image/ResizePreprocessorFactory.hpp"

#include <cstdint>
#include <memory>

// IDatasetRepositoryFactory の実装。
// create() の引数(taskType/config/split)はデータセットごとに変わる値のみとし、
// 学習run全体で固定の協力者(デコーダ・前処理ファクトリ・バッチサイズ等)は
// コンストラクタでDI注入する(TorchModelFactory が TorchLayerBuilder を保持するのと同じ形)。
class DatasetRepositoryFactory : public IDatasetRepositoryFactory
{
public:
    DatasetRepositoryFactory(std::shared_ptr<IImageDecoder> decoder,
                             std::shared_ptr<LabelMapFileReader> labelMapReader,
                             ResizePreprocessorFactory preprocessorFactory,
                             uint8_t maskIgnoreIndex,
                             std::shared_ptr<TrainParam> trainParam);

    std::shared_ptr<IDatasetRepository> create(const TrainingTaskType &taskType, const DatasetConfig &config, DatasetSplit split) const override;

private:
    // ① モダリティ
    std::shared_ptr<IDatasetRepository> createImage(ImageTaskType, const DatasetConfig &, DatasetSplit) const;
    // ② 形式 (variant の型で分岐)
    std::shared_ptr<IDatasetRepository> createPascalVoc(ImageTaskType, const PascalVocConfig &, const DatasetConfig &, DatasetSplit) const;
    // ③ タスク (enum で分岐) は各 createXxx 内の switch

    std::shared_ptr<IImageDecoder> _decoder;
    std::shared_ptr<LabelMapFileReader> _labelMapReader;
    ResizePreprocessorFactory _preprocessorFactory;
    uint8_t _maskIgnoreIndex;
    std::shared_ptr<TrainParam> _trainParam;
};