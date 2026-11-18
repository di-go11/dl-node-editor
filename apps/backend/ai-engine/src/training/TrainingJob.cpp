#include "training/TrainingJob.hpp"

#include <memory>
#include <torch/torch.h>

// entities
#include "training/entities/domain-objects/TrainParam.hpp"
#include "training/entities/domain-objects/ModelGraph/ModelGraph.hpp"
#include "training/entities/domain-objects/ModelGraph/ModelGraphFingerprint.hpp"
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
#include "training/infrastructure/torchModel/CheckpointArchiveIO.hpp"
#include "training/infrastructure/dataset/DatasetRepositoryFactory.hpp"
#include "training/infrastructure/dataset/PreFetchDatasetRepository.hpp"
#include "training/infrastructure/image/OpenCvImageDecoder.hpp"
#include "training/entities/image/LetterboxPolicy.hpp"
#include "training/infrastructure/dataset/DatasetLabelMap.hpp"
#include "training/infrastructure/torchFunc/DeviceToTorch.hpp"
#include "training/infrastructure/dataset/TimedDatasetRepository.hpp"
#include "training/infrastructure/timer/CoutTimeReportWriter.hpp"
#include "training/infrastructure/torchModel/TorchModelEvaluator.hpp"
#include "training/infrastructure/torchFunc/SeedApplier.hpp"

#include <filesystem>
#include <iostream>

// application(インターフェース)
#include "training/application/interfaces/parallelProcessFn/IParallelExecutor.hpp"

// adapters(インタフェース)
#include "training/adapters/interfaces/IModel.hpp"
#include "training/adapters/interfaces/IOptimizer.hpp"
#include "training/adapters/interfaces/ISeed.hpp"

// adapters/application(具象クラス)
#include "training/adapters/impl/TorchModelTrainer.hpp"
#include "training/adapters/impl/timer/BufferTimeRecorder.hpp"
#include "training/adapters/impl/timer/NullTimeRecorder.hpp"
#include "training/application/impl/TrainModelUsecase.hpp"
#include "training/application/impl/TrainingDatasets.hpp"
#include "training/application/impl/TrainingResumeState.hpp"
#include "training/application/impl/TrainingStopToken.hpp"
#include "training/application/interfaces/ITrainingProgressObserver.hpp"
#include "training/application/interfaces/ITrainingJobManager.hpp" // TrainingPreconditionError
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

    void requireModelId(const StartTrainingCommand &command)
    {
        if (command.modelId.empty())
        {
            throw std::invalid_argument("学習ジョブ: model_id が空です");
        }
    }

    // resume = true のときの再開元(<modelId>_last.pt)。ファイルがなければ TrainingPreconditionError。
    std::string requireResumeCheckpointPath(const TrainingRuntimeConfig &runtime, const StartTrainingCommand &command)
    {
        const std::string path = TorchCheckpointStore::lastCheckpointPath(runtime.checkpointOutputDirPath, command.modelId);
        if (!std::filesystem::exists(path))
        {
            throw TrainingPreconditionError("resume が指定されましたが、再開用の checkpoint がありません: " + path);
        }
        return path;
    }

    // checkpoint がすでに指定エポック数まで学習済みなら TrainingPreconditionError。
    // そのまま進めると 1 エポックも回さずに Completed を返し、「学習した」と誤解されるため。
    // meta.epoch は「最後に完了したエポック」(0 始まり)なので、学習済みのエポック数は meta.epoch + 1。
    void requireEpochsRemaining(const CheckpointMeta &meta, unsigned int totalEpochs, const std::string &path)
    {
        const unsigned int completedEpochs = meta.epoch + 1u;
        if (completedEpochs >= totalEpochs)
        {
            throw TrainingPreconditionError(
                "checkpoint はすでに " + std::to_string(completedEpochs) + " エポック学習済みで、指定された合計エポック数(" +
                std::to_string(totalEpochs) + ")に達しています。続けるには epoch を増やしてください: " + path);
        }
    }

} // namespace

void checkTrainingJobPreconditions(const TrainingRuntimeConfig &runtime, const StartTrainingCommand &command)
{
    requireModelId(command);
    if (!command.resume)
    {
        return;
    }

    const std::string path = requireResumeCheckpointPath(runtime, command);
    CheckpointMeta meta;
    try
    {
        // ここでは epoch を見るだけなので、モデルは作らずにメタ情報だけ読む。
        torch::serialize::InputArchive archive;
        archive.load_from(path);
        meta = readCheckpointMeta(archive);
    }
    catch (const std::exception &e)
    {
        throw TrainingPreconditionError("再開用の checkpoint を読めません: " + path + " (" + e.what() + ")");
    }
    requireEpochsRemaining(meta, command.epochSize, path);
}

TrainingStatus runTrainingJob(const TrainingRuntimeConfig &runtime,
                              const StartTrainingCommand &command,
                              const std::shared_ptr<ITrainingProgressObserver> &progressObserver,
                              const ISeed &seedApplier,
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
    if (!command.modelGraph.has_value())
    {
        throw std::runtime_error("runTrainingJob: command.modelGraph が設定されていません");
    }

    training::infrastructure::torchFunc::ensureComputeDeviceAvailable(command.device);

    // TrainParamの設定
    auto param = std::make_shared<TrainParam>(command.epochSize, command.batchSize);

    // ParallelExecutorの生成。(現在は逐次処理のみだが、将来的に並列化する場合は追加する。)
    auto parallelExecutor = createParallelExecutor(runtime.imageLoadThreadCount);

    // ITimeRecorderの生成。(enableTimeMeasurement が false ならダミー実装)
    auto timeRecorder = createTimeRecorder(runtime.enableProcessTimeMeasurement);

    // データセットの形式の色表からクラス数を決める(モデル出力チャンネル数の単一の参照元)。
    // pascal_voc は VOC のカラーマップ(21 クラス)、original は labelmap.txt の行数。
    const ColorLabelMap labelMap = loadDatasetLabelMap(imageSpec->annotation, command.datasetPath);
    const int numClasses = static_cast<int>(labelMap.entryCount());
    std::cout << "numClasses = " << numClasses << std::endl;

    // ignore_index がクラス ID(0〜numClasses-1)と重なると、そのクラスの画素がすべて学習・評価から外れる。
    if (static_cast<int>(segmentationSpec->ignoreIndex) < numClasses)
    {
        throw std::runtime_error("runTrainingJob: ignore_index(" + std::to_string(segmentationSpec->ignoreIndex) +
                                 ")がクラス ID(0〜" + std::to_string(numClasses - 1) +
                                 ")と重なっています。クラス数以上の値(通常は 255)にしてください");
    }

    // モデル / Optimizer の生成口。checkpoint からの再構築(CheckpointModelLoader)も
    // 同じ factory を使うため、cold start 側もここを通しておく。
    auto modelFactory = std::make_shared<TorchModelFactory>();
    auto optimizerFactory = std::make_shared<TorchOptimizerFactory>();
    auto lossFactory = std::make_shared<TorchLossFactory>();

    // ---- 再開元の決定 ----
    // resume フラグだけで決める。ファイルがあるかどうかで自動的に再開はしない
    // (resume = false なら、<modelId>_last.pt があっても読まずに最初から学習する)。
    // gRPC では checkTrainingJobPreconditions で確認済みだが、CLI からの呼び出しや、
    // 確認後にファイルが消された場合に備えて、ここでも同じ確認をする。
    requireModelId(command);
    const std::string resumePath = command.resume ? requireResumeCheckpointPath(runtime, command) : std::string{};

    if (command.seed.has_value())
    {
        seedApplier.apply(command.seed.value());
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
        requireEpochsRemaining(restored.meta, command.epochSize, resumePath);

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
        if (modelGraphFingerprint(graph) != modelGraphFingerprint(command.modelGraph->getGraph()))
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
        graph = command.modelGraph->getGraph();
        model = modelFactory->create(*command.modelGraph, command.device);
        params = model->parameters();
        optimizer = optimizerFactory->create(params, command.optimizer);
    }

    // ignoreIndex はマスクの Letterbox 余白を埋める値。損失(MseLoss を除く)と評価(mIoU/accuracy)の
    // 双方でこの値のピクセルを無視する。評価器と DatasetRepositoryFactory も同じ SegmentationSpec から読む。
    auto loss = lossFactory->create(command.loss, numClasses, segmentationSpec->ignoreIndex);

    auto trainer = std::make_shared<TorchModelTrainer>(model, loss, optimizer);
    auto evaluator = std::make_shared<TorchModelEvaluator>(*model, *loss, numClasses, imageSpec->taskSpecs);
    auto checkpointStore = std::make_shared<TorchCheckpointStore>(model, optimizer, runtime.checkpointOutputDirPath, command.modelId, graph);

    TrainModelUsecase usecase(param, command.saveLastEvery, trainer, evaluator, checkpointStore, progressObserver);

    auto decoder = std::make_shared<OpenCvImageDecoder>();
    auto timedDecoder = std::make_shared<TimedImageDecoder>(decoder, timeRecorder, "image.decode");

    // Datasetの作成
    // 入力サイズ・ignoreIndex は command.dataSpec から Factory が読む。アスペクト比の扱いだけここで決める。
    DatasetSplit trainsplit = DatasetSplit::Train;
    DatasetSplit valsplit = DatasetSplit::Validation;
    auto datasetRepository = std::make_shared<DatasetRepositoryFactory>(timedDecoder, LetterboxPolicy{}, param, timeRecorder, parallelExecutor);

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
