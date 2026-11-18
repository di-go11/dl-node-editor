#include "training/TrainingApp.hpp"

#include "training/TrainingJob.hpp"

// entities
#include "training/entities/domain-objects/ModelArchitectureType.hpp"

// application(具象クラス)
#include "training/application/impl/ModelGraphPresets.hpp"

// infrastructure(具象クラス)
#include "training/infrastructure/readConfig/ConfigReader.hpp"
#include "training/infrastructure/dataset/DatasetLabelMap.hpp"
#include "training/infrastructure/torchFunc/SeedApplier.hpp"

// adapters(具象クラス)
#include "training/adapters/impl/ConsoleProgressObserver.hpp"

#include <exception>
#include <memory>
#include <stdexcept>
#include <string>
#include <variant>

void runTraining()
{
    // configの読み込み
    ConfigReader configReader;
    TrainingConfigFile config = configReader.readAll(".config");

    // CLI ではモデル構造を .config の model_architecture とクラス数から組み立てる。
    // クラス数はデータセットの形式の色表のエントリ数(モデル出力チャンネル数の単一の参照元)。
    // PascalVoc は VOC のカラーマップ(21 クラス)、Original は labelmap.txt の行数。
    const ImageSpec *imageSpec = std::get_if<ImageSpec>(&config.command.dataSpec);
    if (imageSpec == nullptr)
    {
        throw std::runtime_error("runTraining: 現在は画像(training_task = Image)のみ対応しています");
    }
    const int numClasses =
        static_cast<int>(loadDatasetLabelMap(imageSpec->annotation, config.command.datasetPath).entryCount());

    // モデル構造用のポインタ生成
    std::unique_ptr<IModelGraphPreset> modelGraphPreset;
    switch (config.architecture)
    {
    case ModelArchitectureType::SegNet:
        modelGraphPreset = std::make_unique<SegnetModelSample>();
        break;
    case ModelArchitectureType::Unet:
        modelGraphPreset = std::make_unique<UnetModelSample>();
        break;
    }
    config.command.modelGraph = modelGraphPreset->buildGraph(numClasses);
    const auto seedApplier = std::make_unique<SeedApplier>();

    // CLI では進捗を標準出力に書く。停止要求は受け付けない(Ctrl+C で止める)。
    auto progressObserver = std::make_shared<ConsoleProgressObserver>();
    try
    {
        const TrainingStatus status = runTrainingJob(config.runtime, config.command, progressObserver, *seedApplier);
        progressObserver->onFinished(status, "");
    }
    catch (const std::exception &e)
    {
        progressObserver->onFinished(TrainingStatus::Failed, e.what());
        throw;
    }
}
