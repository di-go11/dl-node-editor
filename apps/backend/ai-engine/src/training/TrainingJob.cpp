#include "training/TrainingJob.hpp"

#include <memory>
#include <torch/torch.h>

// entities
#include "training/entities/domain-objects/TrainParam.hpp"
#include "training/entities/domain-objects/ModelGraph.hpp"
#include "training/entities/domain-objects/ModelGraphFingerprint.hpp"
#include "training/entities/domain-objects/DatasetSplit.hpp"
#include "training/entities/domain-objects/ProcessTimeSpan.hpp"

#include <stdexcept>

// infrastructure(具象クラス)
#include "training/infrastructure/torchFunc/TorchOptimizerFactory.hpp"
#include "training/infrastructure/torchFunc/TorchLossFactory.hpp"
#include "training/infrastructure/torchModel/TorchModel.hpp"
#include "training/infrastructure/torchModel/TorchModelFactory.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointStore.hpp"
#include "training/infrastructure/torchModel/CheckpointModelLoader.hpp"
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
#include "training/application/impl/TrainingStopToken.hpp"
#include "training/application/interfaces/ITrainingProgressObserver.hpp"
#include "training/adapters/impl/timer/TimedImageDecoder.hpp"
#include "training/adapters/impl/parallelProcessFn/SequentialExecutor.hpp"
#include "training/adapters/impl/parallelProcessFn/ThreadExecutor.hpp"

namespace
{
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

TrainingStatus runTrainingJob(const ServerConfig &server,
                              const StartTrainingCommand &command,
                              const std::shared_ptr<ITrainingProgressObserver> &progressObserver,
                              const TrainingStopToken *stopToken)
{
    // この学習パイプラインは画像セグメンテーション専用(評価器・データセットが対応していない)。
    const ImageSpec *imageSpec = std::get_if<ImageSpec>(&command.dataSpec);
    const SegmentationSpec *segmentationSpec = imageSpec ? std::get_if<SegmentationSpec>(&imageSpec->taskSpecs) : nullptr;
    if (segmentationSpec == nullptr)
    {
        throw std::runtime_error("runTrainingJob: 現在は画像セグメンテーション(training_task = Image, training_task_type = Segmentation)のみ対応しています");
    }
    // モデル構造は呼び出し側(CLI ならアーキテクチャ名から、gRPC ならリクエストから)が必ず埋める。
    if (command.modelGraph.layers.empty())
    {
        throw std::runtime_error("runTrainingJob: command.modelGraph が空です");
    }

    training::infrastructure::torchFunc::ensureComputeDeviceAvailable(command.device);

    // TrainParamの設定
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

        // 復元した構造が今回依頼された構造(command.modelGraph)と食い違っていないか確認する。
        // 不一致でも学習自体は走ってしまうが、意図しない checkpoint の可能性があるため警告する。
        if (modelGraphFingerprint(graph) != modelGraphFingerprint(command.modelGraph))
        {
            std::cerr << "[warn] checkpoint のモデル構造が、今回指定されたモデル構造"
                         "(numClasses="
                      << numClasses << ")と異なります。"
                                       "意図した checkpoint か確認してください。"
                      << std::endl;
        }
    }
    else
    {
        // cold start: 依頼された構造から、モデル・Optimizer を作る。
        graph = command.modelGraph;
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

    TrainModelUsecase usecase(param, command.saveLastEvery, trainer, evaluator, checkpointStore, progressObserver);

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

    return usecase.execute(datasets, resumeState, stopToken);
}
