#pragma once

// 継承元: IDatasetRepositoryFactory
#include "training/application/interfaces/IDatasetRepositoryFactory.hpp"

// 注入インターフェース
#include "training/application/interfaces/ITimeRecorder.hpp"
#include "training/application/interfaces/parallelProcessFn/IParallelExecutor.hpp"
#include "training/application/interfaces/image/IImageDecoder.hpp"

// 注入クラス
#include "training/entities/domain-objects/DataSpecs/DataSpec.hpp"
#include "training/entities/domain-objects/ImageAnnotationConfig.hpp"
#include "training/entities/domain-objects/TrainParam.hpp"
#include "training/entities/image/AspectRatioPolicy.hpp"

#include "training/infrastructure/dataset/LabelMapFileReader.hpp"
#include "training/infrastructure/image/ResizePreprocessorFactory.hpp"

#include <memory>
#include <string>

// IDatasetRepositoryFactory の実装。
// create() の引数(spec/datasetPath/split)はデータセットごとに変わる値のみとし、
// 学習run全体で固定の協力者(デコーダ・アスペクト比の扱い・バッチサイズ等)は
// コンストラクタでDI注入する(TorchModelFactory が TorchLayerBuilder を保持するのと同じ形)。
// 入力サイズと ignoreIndex は DataSpec から読む。
class DatasetRepositoryFactory : public IDatasetRepositoryFactory
{
public:
    // aspectRatioPolicy: リサイズ時のアスペクト比の扱い。DataSpec には含まれない、サーバー側の実装で決める値。
    DatasetRepositoryFactory(std::shared_ptr<IImageDecoder> decoder,
                             std::shared_ptr<LabelMapFileReader> labelMapReader,
                             AspectRatioPolicy aspectRatioPolicy,
                             std::shared_ptr<TrainParam> trainParam,
                             std::shared_ptr<ITimeRecorder> timeRecorder,
                             std::shared_ptr<IParallelExecutor> parallelExecutor);

    std::shared_ptr<IDatasetRepository> create(const DataSpec &spec, const std::string &datasetPath, DatasetSplit split) const override;

private:
    // ① モダリティ (DataSpec の型で分岐)
    std::shared_ptr<IDatasetRepository> createImage(const ImageSpec &, const std::string &datasetPath, DatasetSplit) const;
    // ② 形式 (ImageAnnotationConfig の型で分岐)
    // ③ タスク (ImageTaskSpecs の型で分岐) は各 createXxx 内の visit
    std::shared_ptr<IDatasetRepository> createPascalVoc(const PascalVocConfig &, const ImageSpec &, const std::string &datasetPath, DatasetSplit) const;

    // 画像・マスク共通のジオメトリ(入力サイズ + アスペクト比の扱い)を持つ前処理ファクトリを作る。
    ResizePreprocessorFactory makePreprocessorFactory(const ImageSpec &) const;

    std::shared_ptr<IImageDecoder> _decoder;
    std::shared_ptr<LabelMapFileReader> _labelMapReader;
    AspectRatioPolicy _aspectRatioPolicy;
    std::shared_ptr<TrainParam> _trainParam;
    std::shared_ptr<ITimeRecorder> _timeRecorder;
    std::shared_ptr<IParallelExecutor> _parallelExecutor;
};
