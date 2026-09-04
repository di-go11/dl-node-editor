#include <memory>
#include <torch/torch.h>

// entities
#include "training/entities/domain-objects/TrainParam.hpp"
#include "training/entities/domain-objects/ModelGraph.hpp"
#include "training/entities/domain-objects/Conv2DParams.hpp"
#include "training/entities/domain-objects/ActivationParams.hpp"
#include "training/entities/domain-objects/DatasetSplit.hpp"

// infrastructure(具象クラス)
#include "training/infrastructure/torchFunc/TorchLayerBuilder.hpp"
#include "training/infrastructure/torchFunc/TorchOptimizerFactory.hpp"
#include "training/infrastructure/torchModel/TorchModel.hpp"
#include "training/infrastructure/torchModel/TorchModelFactory.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointStore.hpp"
#include "training/infrastructure/torchModel/CheckpointModelLoader.hpp"
#include "training/infrastructure/torchFunc/CrossEntropy.hpp"
#include "training/infrastructure/readConfig/ConfigReader.hpp"

#include "training/infrastructure/image/OpenCvImageDecoder.hpp"
#include "training/infrastructure/image/ResizePreprocessorFactory.hpp"
#include "training/infrastructure/dataset/LabelMapFileReader.hpp"
#include "training/infrastructure/dataset/VocDatasetRepository.hpp"

#include <filesystem>
#include <iostream>

// adapters(インタフェース)
#include "training/adapters/interfaces/IModel.hpp"
#include "training/adapters/interfaces/IOptimizer.hpp"

// adapters/application(具象クラス)
#include "training/adapters/impl/TorchModelTrainer.hpp"
#include "training/infrastructure/torchModel/TorchModelEvaluator.hpp"
#include "training/application/impl/TrainModelUsecase.hpp"
#include "training/application/impl/TrainingDatasets.hpp"

// numClasses = セグメンテーションのクラス数(labelmap.txt のエントリ数)。
// 最終層は「クラス数チャンネルの生ロジット」を出力する。CrossEntropy が
// 内部で log_softmax するため、末尾に活性化層は置かない。
ModelGraph buildSampleModelGraph(int numClasses)
{
    ModelGraph graph;

    Conv2DParams conv;
    conv.inChannels = 3; // 実データ(RGB画像)に合わせて3チャンネル
    conv.outChannels = numClasses;
    conv.kernelSize = 3;
    conv.stride = 1;
    conv.padding = 1;
    graph.layers.push_back(LayersConfig{conv});

    return graph;
}

int main(void)
{
    // configの読み込み
    ConfigReader configReader;

    AppConfig appConfig = configReader.readAll(".config");

    // TrainParamの設定(.configから取得。将来的にGUI入力にも置き換わる想定)
    auto param = std::make_shared<TrainParam>(appConfig.epochSize, appConfig.batchSize);

    // labelmap.txt からクラス数を決める(モデル出力チャンネル数の単一の参照元)。
    const std::string labelMapPath =
        (std::filesystem::path(appConfig.datasetPath) / "labelmap.txt").string();
    const ColorLabelMap labelMap = LabelMapFileReader{}.read(labelMapPath);
    const int numClasses = static_cast<int>(labelMap.entryCount());
    std::cout << "numClasses = " << numClasses << std::endl;

    // モデル / Optimizer の生成口。checkpoint からの再構築(CheckpointModelLoader)も
    // 同じ factory を使うため、cold start 側もここを通しておく。
    auto modelFactory = std::make_shared<TorchModelFactory>();
    auto optimizerFactory = std::make_shared<TorchOptimizerFactory>();

    // cold start: 構造を組み、そこからモデル・Optimizer を作る。
    //
    // 学習再開(resume)を配線するときは、ここを
    //   CheckpointModelLoader loader(modelFactory, optimizerFactory);
    //   RestoredCheckpoint r = loader.load(<.pt のパス>, appConfig.optimizer);
    // に差し替えれば、graph を組み直さずに model / optimizer / meta が得られる。
    // 「どの .pt から再開するか」の判定と開始 epoch の受け渡しは
    // docs/issues/training-resume.md の担当。
    ModelGraph graph = buildSampleModelGraph(numClasses);

    std::shared_ptr<IModel> model = modelFactory->create(graph);
    std::vector<at::Tensor> params = model->parameters();
    std::shared_ptr<IOptimizer> optimizer = optimizerFactory->create(params, appConfig.optimizer);

    auto loss = std::make_shared<CrossEntropy>();

    auto trainer = std::make_shared<TorchModelTrainer>(model, loss, optimizer);
    auto evaluator = std::make_shared<TorchModelEvaluator>(*model, *loss, numClasses);
    auto checkpointStore = std::make_shared<TorchCheckpointStore>(model, optimizer, appConfig.outputDir, appConfig.modelName, graph);

    TrainModelUsecase usecase(param, appConfig, trainer, evaluator, checkpointStore);

    auto decoder = std::make_shared<OpenCvImageDecoder>();

    // 画像・マスク共通のジオメトリ。補間/パディングだけ用途別に切り替える。
    ResizePreprocessorFactory::Geometry geometry;
    geometry.width = appConfig.input_width;
    geometry.height = appConfig.input_height;
    geometry.aspectRatioPolicy = LetterboxPolicy{};
    ResizePreprocessorFactory preprocessorFactory(geometry);

    auto imagePreProcessor = preprocessorFactory.forImage();
    auto maskPreProcessor = preprocessorFactory.forMask(/*ignoreIndex=*/255);

    //
    DatasetSplit trainsplit = DatasetSplit::Train;
    DatasetSplit valsplit = DatasetSplit::Validation;
    auto trainDataset = std::make_shared<VocDatasetRepository>(
        appConfig.datasetPath, decoder, imagePreProcessor, maskPreProcessor, param, trainsplit);
    auto validationDataset = std::make_shared<VocDatasetRepository>(
        appConfig.datasetPath, decoder, imagePreProcessor, maskPreProcessor, param, valsplit);

    TrainingDatasets datasets;
    datasets.trainDataset = trainDataset;
    datasets.validationDataset = validationDataset;

    usecase.execute(datasets);

    std::cout << "training loop finished" << std::endl;

    return 0;
}