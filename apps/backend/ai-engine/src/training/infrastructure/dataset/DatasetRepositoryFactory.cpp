#include "DatasetRepositoryFactory.hpp"

#include "training/infrastructure/dataset/SegmentationDatasetRepository.hpp"
#include "training/infrastructure/dataset/VocSegmentationData.hpp"
#include "training/infrastructure/dataset/TimedVocSegmentationData.hpp"
#include "training/entities/utils/Overloaded.hpp"

#include <stdexcept>
#include <utility>
#include <variant>

namespace
{
    // データセットの分割名を取得する
    const char *splitName(DatasetSplit aplit)
    {
        switch (aplit)
        {
        case DatasetSplit::Train:
            return "train";
        case DatasetSplit::Validation:
            return "val";
        case DatasetSplit::Test:
            return "test";
        default:
            throw std::runtime_error("Unknown DatasetSplit");
        }
    }
}

DatasetRepositoryFactory::DatasetRepositoryFactory(std::shared_ptr<IImageDecoder> decoder,
                                                   std::shared_ptr<LabelMapFileReader> labelMapReader,
                                                   AspectRatioPolicy aspectRatioPolicy,
                                                   std::shared_ptr<TrainParam> trainParam,
                                                   std::shared_ptr<ITimeRecorder> timeRecorder,
                                                   std::shared_ptr<IParallelExecutor> parallelExecutor)
    : _decoder(std::move(decoder)),
      _labelMapReader(std::move(labelMapReader)),
      _aspectRatioPolicy(std::move(aspectRatioPolicy)),
      _trainParam(std::move(trainParam)),
      _timeRecorder(std::move(timeRecorder)),
      _parallelExecutor(std::move(parallelExecutor))
{
}

std::shared_ptr<IDatasetRepository> DatasetRepositoryFactory::create(const DataSpec &spec, const std::string &datasetPath, DatasetSplit split) const
{
    return std::visit(
        Overloaded{
            [&](const ImageSpec &imageSpec) -> std::shared_ptr<IDatasetRepository>
            {
                return createImage(imageSpec, datasetPath, split);
            },
        },
        spec);
}

std::shared_ptr<IDatasetRepository> DatasetRepositoryFactory::createImage(const ImageSpec &imageSpec, const std::string &datasetPath, DatasetSplit split) const
{
    return std::visit(
        Overloaded{
            [&](const PascalVocConfig &annotationConfig) -> std::shared_ptr<IDatasetRepository>
            {
                return createPascalVoc(annotationConfig, imageSpec, datasetPath, split);
            },
        },
        imageSpec.annotation);
}

std::shared_ptr<IDatasetRepository> DatasetRepositoryFactory::createPascalVoc(const PascalVocConfig & /*annotationConfig*/, const ImageSpec &imageSpec, const std::string &datasetPath, DatasetSplit split) const
{
    return std::visit(
        Overloaded{
            [&](const SegmentationSpec &segmentationSpec) -> std::shared_ptr<IDatasetRepository>
            {
                const ResizePreprocessorFactory preprocessorFactory = makePreprocessorFactory(imageSpec);
                auto source = std::make_shared<VocSegmentationData>(datasetPath, _decoder, _labelMapReader, split);
                auto timedSource = std::make_shared<TimedVocSegmentationData>(source, _timeRecorder, std::string(splitName(split)) + ".segdata");
                auto imagePreProcessor = preprocessorFactory.forImage();
                // Letterbox の余白は ignoreIndex で埋め、損失・評価で無視させる。
                auto maskPreProcessor = preprocessorFactory.forMask(segmentationSpec.ignoreIndex);
                return std::make_shared<SegmentationDatasetRepository>(timedSource, imagePreProcessor, maskPreProcessor, _trainParam, _parallelExecutor);
            },
            [](const ObjectDetectionSpec &) -> std::shared_ptr<IDatasetRepository>
            {
                throw std::runtime_error("PascalVoc: ObjectDetection はまだ対応していません");
            },
            [](const ClassificationSpec &) -> std::shared_ptr<IDatasetRepository>
            {
                throw std::runtime_error("PascalVoc: Classification はまだ対応していません");
            },
        },
        imageSpec.taskSpecs);
}

ResizePreprocessorFactory DatasetRepositoryFactory::makePreprocessorFactory(const ImageSpec &imageSpec) const
{
    ResizePreprocessorFactory::Geometry geometry;
    geometry.width = imageSpec.inputWidth;
    geometry.height = imageSpec.inputHeight;
    geometry.aspectRatioPolicy = _aspectRatioPolicy;
    return ResizePreprocessorFactory(geometry);
}
