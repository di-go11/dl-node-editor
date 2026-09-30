#include "training/TrainingApp.hpp"

#include <memory>
#include <torch/torch.h>

// entities
#include "training/entities/domain-objects/TrainParam.hpp"
#include "training/entities/domain-objects/ModelGraph.hpp"
#include "training/entities/domain-objects/ModelGraphFingerprint.hpp"
#include "training/entities/domain-objects/Conv2DParams.hpp"
#include "training/entities/domain-objects/ActivationParams.hpp"
#include "training/entities/domain-objects/BatchNormParams.hpp"
#include "training/entities/domain-objects/IndexedPoolingParams.hpp"
#include "training/entities/domain-objects/UnpoolingParams.hpp"
#include "training/entities/domain-objects/ModelArchitectureType.hpp"
#include "training/entities/domain-objects/DatasetSplit.hpp"
#include "training/entities/domain-objects/ProcessTimeSpan.hpp"

#include <stdexcept>

// infrastructure(具象クラス)
#include "training/infrastructure/torchFunc/TorchLayerBuilder.hpp"
#include "training/infrastructure/torchFunc/TorchOptimizerFactory.hpp"
#include "training/infrastructure/torchFunc/TorchLossFactory.hpp"
#include "training/infrastructure/torchModel/TorchModel.hpp"
#include "training/infrastructure/torchModel/TorchModelFactory.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointStore.hpp"
#include "training/infrastructure/torchModel/CheckpointModelLoader.hpp"
#include "training/infrastructure/readConfig/ConfigReader.hpp"
#include "training/infrastructure/dataset/DatasetRepositoryFactory.hpp"
#include "training/infrastructure/dataset/PreFetchDatasetRepository.hpp"
#include "training/infrastructure/image/OpenCvImageDecoder.hpp"
#include "training/entities/image/LetterboxPolicy.hpp"
#include "training/infrastructure/dataset/LabelMapFileReader.hpp"
#include "training/infrastructure/torchFunc/DeviceToTorch.hpp"
#include "training/infrastructure/dataset/TimedDatasetRepository.hpp"
#include "training/infrastructure/timer/CoutTimeReportWriter.hpp"
#include "training/infrastructure/torchModel/TorchModelEvaluator.hpp"

#include <filesystem>
#include <iostream>

// application(インターフェース)
#include "training/application/interfaces/parallelProcessFn/IParallelExecutor.hpp"

// adapters(インタフェース)
#include "training/adapters/interfaces/IModel.hpp"
#include "training/adapters/interfaces/IOptimizer.hpp"

// adapters/application(具象クラス)
#include "training/adapters/impl/TorchModelTrainer.hpp"
#include "training/adapters/impl/timer/BufferTimeRecorder.hpp"
#include "training/adapters/impl/timer/NullTimeRecorder.hpp"
#include "training/application/impl/TrainModelUsecase.hpp"
#include "training/application/impl/TrainingDatasets.hpp"
#include "training/application/impl/TrainingResumeState.hpp"
#include "training/adapters/impl/timer/TimedImageDecoder.hpp"
#include "training/adapters/impl/parallelProcessFn/SequentialExecutor.hpp"
#include "training/adapters/impl/parallelProcessFn/ThreadExecutor.hpp"

namespace
{
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

    // Conv(3x3,pad=1) -> ReLU -> BatchNorm を2回繰り返す共通ブロック。
    // SegNet の encoder/decoder ブロックは中身が同一構造(python版 segnetProgram.py
    // の encoder_block / decoder_block に相当)。
    void appendConvReluBnPair(ModelGraph &graph, int inChannels, int outChannels, double bnMomentum)
    {
        Conv2DParams conv1;
        conv1.inChannels = inChannels;
        conv1.outChannels = outChannels;
        conv1.kernelSize = 3;
        conv1.stride = 1;
        conv1.padding = 1;
        graph.layers.push_back(LayersConfig{conv1});

        ActivationConfig relu1;
        relu1.activationType = ActivationType::ReLU;
        graph.layers.push_back(LayersConfig{relu1});

        BatchNormParams bn1;
        bn1.numFeatures = outChannels;
        bn1.momentum = bnMomentum;
        graph.layers.push_back(LayersConfig{bn1});

        Conv2DParams conv2;
        conv2.inChannels = outChannels;
        conv2.outChannels = outChannels;
        conv2.kernelSize = 3;
        conv2.stride = 1;
        conv2.padding = 1;
        graph.layers.push_back(LayersConfig{conv2});

        ActivationConfig relu2;
        relu2.activationType = ActivationType::ReLU;
        graph.layers.push_back(LayersConfig{relu2});

        BatchNormParams bn2;
        bn2.numFeatures = outChannels;
        bn2.momentum = bnMomentum;
        graph.layers.push_back(LayersConfig{bn2});
    }

    // encoder_block: Conv×2 の後に indices を記録する pooling。
    void appendEncoderBlock(ModelGraph &graph, int inChannels, int outChannels, double bnMomentum)
    {
        appendConvReluBnPair(graph, inChannels, outChannels, bnMomentum);

        IndexedPoolingParams pool;
        pool.kernelSize = 2;
        pool.stride = 2;
        pool.padding = 0;
        graph.layers.push_back(LayersConfig{pool});
    }

    // decoder_block: 対応する pooling の indices を使う unpooling の後に Conv×2。
    // (python 版 forward() の d5 = dec5[1](e5, indic5); d5 = dec5[0](d5) の順に対応)
    void appendDecoderBlock(ModelGraph &graph, int inChannels, int outChannels, double bnMomentum)
    {
        UnpoolingParams unpool;
        unpool.kernelSize = 2;
        unpool.stride = 2;
        unpool.padding = 0;
        graph.layers.push_back(LayersConfig{unpool});

        appendConvReluBnPair(graph, inChannels, outChannels, bnMomentum);
    }

    // segnetProgram.py の SegNet を再現したグラフ。pooling で得た indices は
    // TorchModel 内の LIFO スタックで対応する unpooling まで運ばれる
    // (enc5→dec5, enc4→dec4, ... という対称構造が前提)。
    ModelGraph buildSegNetGraph(int numClasses)
    {
        ModelGraph graph;
        constexpr double bnMomentum = 0.5; // python 版の BN_momentum デフォルトに合わせる

        // Encoder
        appendEncoderBlock(graph, 3, 64, bnMomentum);
        appendEncoderBlock(graph, 64, 128, bnMomentum);
        appendEncoderBlock(graph, 128, 256, bnMomentum);
        appendEncoderBlock(graph, 256, 512, bnMomentum);
        appendEncoderBlock(graph, 512, 512, bnMomentum);

        // Decoder(対称)
        appendDecoderBlock(graph, 512, 512, bnMomentum);
        appendDecoderBlock(graph, 512, 256, bnMomentum);
        appendDecoderBlock(graph, 256, 128, bnMomentum);
        appendDecoderBlock(graph, 128, 64, bnMomentum);
        appendDecoderBlock(graph, 64, numClasses, bnMomentum);

        return graph;
    }

    // .config の model_architecture に応じてグラフ組み立て関数を選ぶ。
    ModelGraph buildGraph(ModelArchitectureType architecture, int numClasses)
    {
        switch (architecture)
        {
        case ModelArchitectureType::Sample:
            return buildSampleModelGraph(numClasses);
        case ModelArchitectureType::SegNet:
            return buildSegNetGraph(numClasses);
        }
        throw std::runtime_error("runTraining: unknown ModelArchitectureType");
    }

    std::shared_ptr<ITimeRecorder> createTimeRecorder(bool enableTimeMeasurement)
    {
        if (enableTimeMeasurement)
        {
            auto timeReportWriter = std::make_shared<CoutTimeReportWriter>();
            return std::make_shared<BufferTimeRecorder>(timeReportWriter);
        }
        else
        {
            return std::make_shared<NullTimeRecorder>();
        }
    }

    std::shared_ptr<IParallelExecutor> createParallelExecutor(size_t threadCount)
    {
        if (threadCount == 1)
        {
            return std::make_shared<SequentialExecutor>();
        }
        else if (threadCount > 1)
        {
            return std::make_shared<ThreadExecutor>(threadCount);
        }
        else
        {
            throw std::runtime_error("Invalid threadCount value: " + std::to_string(threadCount));
        }
    }

} // namespace

void runTraining()
{
    // configの読み込み
    ConfigReader configReader;

    const TrainingConfigFile config = configReader.readAll(".config");
    const ServerConfig &server = config.server;
    const StartTrainingCommand &command = config.command;

    // この学習パイプラインは画像セグメンテーション専用(評価器・データセットが対応していない)。
    const ImageSpec *imageSpec = std::get_if<ImageSpec>(&command.dataSpec);
    const SegmentationSpec *segmentationSpec = imageSpec ? std::get_if<SegmentationSpec>(&imageSpec->taskSpecs) : nullptr;
    if (segmentationSpec == nullptr)
    {
        throw std::runtime_error("runTraining: 現在は画像セグメンテーション(training_task = Image, training_task_type = Segmentation)のみ対応しています");
    }

    training::infrastructure::torchFunc::ensureComputeDeviceAvailable(command.device);

    // TrainParamの設定(.configから取得。将来的にGUI入力にも置き換わる想定)
    auto param = std::make_shared<TrainParam>(command.epochSize, command.batchSize);

    // ParallelExecutorの生成。(現在は逐次処理のみだが、将来的に並列化する場合は追加する。)
    auto parallelExecutor = createParallelExecutor(server.threadCount);

    // ITimeRecorderの生成。(enableTimeMeasurement が false ならダミー実装)
    auto timeRecorder = createTimeRecorder(server.enableProcessTimeMeasurement);

    // labelmap.txt からクラス数を決める(モデル出力チャンネル数の単一の参照元)。
    const std::string labelMapPath =
        (std::filesystem::path(command.datasetPath) / "labelmap.txt").string();
    const ColorLabelMap labelMap = LabelMapFileReader{}.read(labelMapPath);
    const int numClasses = static_cast<int>(labelMap.entryCount());
    std::cout << "numClasses = " << numClasses << std::endl;

    // モデル / Optimizer の生成口。checkpoint からの再構築(CheckpointModelLoader)も
    // 同じ factory を使うため、cold start 側もここを通しておく。
    auto modelFactory = std::make_shared<TorchModelFactory>();
    auto optimizerFactory = std::make_shared<TorchOptimizerFactory>();
    auto lossFactory = std::make_shared<TorchLossFactory>();

    // ---- 再開元の決定 ----
    // 1. resume_from が指定されていればそれを使う(GUI のファイル選択結果もここに入る)
    // 2. 指定がなくても <modelName>_last.pt があれば自動で再開する
    // 3. どちらもなければ cold start
    const std::string modelFileName = command.modelName.empty() ? "model" : command.modelName;
    const std::string autoResumePath =
        (std::filesystem::path(server.checkpointOutputDirPath) / (modelFileName + "_last.pt")).string();

    std::string resumePath;
    if (!command.resumeFrom.empty())
    {
        resumePath = command.resumeFrom;
    }
    else if (std::filesystem::exists(autoResumePath))
    {
        resumePath = autoResumePath;
    }

    ModelGraph graph;
    std::shared_ptr<IModel> model;
    std::shared_ptr<IOptimizer> optimizer;
    std::vector<at::Tensor> params;
    TrainingResumeState resumeState; // 既定値 = cold start

    if (!resumePath.empty())
    {
        // 再開: checkpoint から構造ごと組み直す。保存時と同じ ModelGraph を
        // ここで手組みする必要はない(CheckpointModelLoader が構造を復元する)。
        std::cout << "resume from: " << resumePath << std::endl;

        CheckpointModelLoader loader(modelFactory, optimizerFactory);
        RestoredCheckpoint restored = loader.load(resumePath, command.optimizer, command.device);

        graph = restored.graph;
        model = restored.model;
        optimizer = restored.optimizer;
        params = restored.parameters;

        // meta.epoch は「最後に完了したエポック」なので次はその翌エポックから。
        resumeState.startEpoch = restored.meta.epoch + 1u;
        resumeState.initialBest = restored.meta.bestMetric;
        resumeState.hasInitialBest = true;

        // 復元した構造が現在のデータセット(クラス数)と食い違っていないか確認する。
        // 不一致でも学習自体は走ってしまうが、評価指標が意味を成さなくなるため警告する。
        if (modelGraphFingerprint(graph) != modelGraphFingerprint(buildGraph(config.architecture, numClasses)))
        {
            std::cerr << "[warn] checkpoint のモデル構造が現在の設定"
                         "(numClasses="
                      << numClasses << ")から組む構造と異なります。"
                                       "意図した checkpoint か確認してください。"
                      << std::endl;
        }
    }
    else
    {
        // cold start: 構造を組み、そこからモデル・Optimizer を作る。
        graph = buildGraph(config.architecture, numClasses);
        model = modelFactory->create(graph, command.device);
        params = model->parameters();
        optimizer = optimizerFactory->create(params, command.optimizer);
    }

    // ignoreIndex はマスクの Letterbox 余白を埋める値。損失(MseLoss を除く)と評価(mIoU/accuracy)の
    // 双方でこの値のピクセルを無視する。評価器と DatasetRepositoryFactory も同じ SegmentationSpec から読む。
    auto loss = lossFactory->create(command.loss, numClasses, segmentationSpec->ignoreIndex);

    auto trainer = std::make_shared<TorchModelTrainer>(model, loss, optimizer);
    auto evaluator = std::make_shared<TorchModelEvaluator>(*model, *loss, numClasses, imageSpec->taskSpecs);
    auto checkpointStore = std::make_shared<TorchCheckpointStore>(model, optimizer, server.checkpointOutputDirPath, command.modelName, graph);

    TrainModelUsecase usecase(param, command.saveLastEvery, trainer, evaluator, checkpointStore);

    auto decoder = std::make_shared<OpenCvImageDecoder>();
    auto timedDecoder = std::make_shared<TimedImageDecoder>(decoder, timeRecorder, "image.decode");

    // Datasetの作成
    // 入力サイズ・ignoreIndex は command.dataSpec から Factory が読む。アスペクト比の扱いだけここで決める。
    DatasetSplit trainsplit = DatasetSplit::Train;
    DatasetSplit valsplit = DatasetSplit::Validation;
    auto datasetRepository = std::make_shared<DatasetRepositoryFactory>(timedDecoder, std::make_shared<LabelMapFileReader>(), LetterboxPolicy{}, param, timeRecorder, parallelExecutor);

    // Decorator で包み、次バッチの読み込みを学習と並行して行う。
    // さらに PreFetch の内側と外側を TimedDatasetRepository で包み、処理時間を計測する。
    //   *.produce: ワーカースレッドが 1 バッチを作るのにかかった時間(PreFetch の内側)
    //   *.wait   : 学習ループがバッチの到着を待った時間(PreFetch の外側。待ちは主に hasNext で発生する)
    auto trainInner = datasetRepository->create(command.dataSpec, command.datasetPath, trainsplit);
    auto trainProduce = std::make_shared<TimedDatasetRepository>(trainInner, timeRecorder, "train.produce");
    auto trainPrefetch = std::make_shared<PreFetchDatasetRepository>(trainProduce);
    auto trainDataset = std::make_shared<TimedDatasetRepository>(trainPrefetch, timeRecorder, "train.wait");

    auto validationInner = datasetRepository->create(command.dataSpec, command.datasetPath, valsplit);
    auto validationProduce = std::make_shared<TimedDatasetRepository>(validationInner, timeRecorder, "val.produce");
    auto validationPrefetch = std::make_shared<PreFetchDatasetRepository>(validationProduce);
    auto validationDataset = std::make_shared<TimedDatasetRepository>(validationPrefetch, timeRecorder, "val.wait");

    TrainingDatasets datasets;
    datasets.trainDataset = trainDataset;
    datasets.validationDataset = validationDataset;

    usecase.execute(datasets, resumeState);

    std::cout << "training loop finished" << std::endl;
}
