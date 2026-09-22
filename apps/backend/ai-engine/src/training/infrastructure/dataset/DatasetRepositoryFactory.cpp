#include "DatasetRepositoryFactory.hpp"

#include "training/infrastructure/dataset/SegmentationDatasetRepository.hpp"
#include "training/infrastructure/dataset/VocSegmentationData.hpp"

#include <stdexcept>
#include <utility>
#include <variant>

namespace
{
    template <class... Ts>
    struct Overloaded : Ts...
    {
        using Ts::operator()...;
    };
    template <class... Ts>
    Overloaded(Ts...) -> Overloaded<Ts...>;
}

DatasetRepositoryFactory::DatasetRepositoryFactory(std::shared_ptr<IImageDecoder> decoder,
                                                   std::shared_ptr<LabelMapFileReader> labelMapReader,
                                                   ResizePreprocessorFactory preprocessorFactory,
                                                   uint8_t maskIgnoreIndex,
                                                   std::shared_ptr<TrainParam> trainParam)
    : _decoder(std::move(decoder)),
      _labelMapReader(std::move(labelMapReader)),
      _preprocessorFactory(std::move(preprocessorFactory)),
      _maskIgnoreIndex(maskIgnoreIndex),
      _trainParam(std::move(trainParam))
{
}

std::shared_ptr<IDatasetRepository> DatasetRepositoryFactory::create(const TrainingTaskType &taskType, const DatasetConfig &config, DatasetSplit split) const
{
    return std::visit(
        Overloaded{
            [&](ImageTaskType imageTaskType) -> std::shared_ptr<IDatasetRepository>
            {
                return createImage(imageTaskType, config, split);
            },
        },
        taskType);
}

std::shared_ptr<IDatasetRepository> DatasetRepositoryFactory::createImage(ImageTaskType taskType, const DatasetConfig &config, DatasetSplit split) const
{
    // DatasetAnnotationConfig(モダリティ) = variant<ImageAnnotationConfig>
    // ImageAnnotationConfig(形式)         = variant<PascalVocConfig>
    // の2段ネストなので、外側→内側の順に visit する。
    return std::visit(
        Overloaded{
            [&](const ImageAnnotationConfig &imageAnnotationConfig) -> std::shared_ptr<IDatasetRepository>
            {
                return std::visit(
                    Overloaded{
                        [&](const PascalVocConfig &annotationConfig) -> std::shared_ptr<IDatasetRepository>
                        {
                            return createPascalVoc(taskType, annotationConfig, config, split);
                        },
                    },
                    imageAnnotationConfig);
            },
        },
        config.annotationConfig);
}

std::shared_ptr<IDatasetRepository> DatasetRepositoryFactory::createPascalVoc(ImageTaskType taskType, const PascalVocConfig & /*annotationConfig*/, const DatasetConfig &config, DatasetSplit split) const
{
    switch (taskType)
    {
    case ImageTaskType::SEMANTIC_SEGMENTATION:
    {
        auto source = std::make_shared<VocSegmentationData>(config.datasetPath, _decoder, _labelMapReader, split);
        auto imagePreProcessor = _preprocessorFactory.forImage();
        auto maskPreProcessor = _preprocessorFactory.forMask(_maskIgnoreIndex);
        return std::make_shared<SegmentationDatasetRepository>(source, imagePreProcessor, maskPreProcessor, _trainParam);
    }
    default:
        throw std::runtime_error("Unsupported ImageTaskType for PascalVocConfig");
    }
}
