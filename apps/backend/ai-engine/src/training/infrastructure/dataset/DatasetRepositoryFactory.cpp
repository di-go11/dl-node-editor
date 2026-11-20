#include "DatasetRepositoryFactory.hpp"

#include "training/infrastructure/dataset/DatasetLabelMap.hpp"
#include "training/infrastructure/dataset/SegmentationDatasetRepository.hpp"
#include "training/infrastructure/dataset/VocSegmentationData.hpp"
#include "training/infrastructure/dataset/TimedVocSegmentationData.hpp"
#include "training/infrastructure/image/OpenCvSegmentationAugmenter.hpp"
#include "training/entities/image/AugmentationConfig.hpp"
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
                                                   AspectRatioPolicy aspectRatioPolicy,
                                                   std::shared_ptr<TrainParam> trainParam,
                                                   std::shared_ptr<ITimeRecorder> timeRecorder,
                                                   std::shared_ptr<IParallelExecutor> parallelExecutor,
                                                   uint64_t dataSeed)
    : _decoder(std::move(decoder)),
      _aspectRatioPolicy(std::move(aspectRatioPolicy)),
      _trainParam(std::move(trainParam)),
      _timeRecorder(std::move(timeRecorder)),
      _parallelExecutor(std::move(parallelExecutor)),
      _dataSeed(dataSeed)
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
    // 形式の違いは色表(VOC のカラーマップか labelmap.txt か)だけ。どちらも VOC のディレクトリ構成で読む。
    // 形式を足して構成も変わるときは、ここで imageSpec.annotation を visit して createXxx を分ける。
    const ColorLabelMap labelMap = loadDatasetLabelMap(imageSpec.annotation, datasetPath);
    return createVocLayout(labelMap, imageSpec, datasetPath, split);
}

std::shared_ptr<IDatasetRepository> DatasetRepositoryFactory::createVocLayout(const ColorLabelMap &labelMap, const ImageSpec &imageSpec, const std::string &datasetPath, DatasetSplit split) const
{
    return std::visit(
        Overloaded{
            [&](const SegmentationSpec &segmentationSpec) -> std::shared_ptr<IDatasetRepository>
            {
                const ResizePreprocessorFactory preprocessorFactory = makePreprocessorFactory(imageSpec);
                auto source = std::make_shared<VocSegmentationData>(datasetPath, _decoder, labelMap, split,
                                                                    segmentationSpec.ignoreIndex, segmentationSpec.ignoreColor);
                auto timedSource = std::make_shared<TimedVocSegmentationData>(source, _timeRecorder, std::string(splitName(split)) + ".segdata");
                auto imagePreProcessor = preprocessorFactory.forImage();
                // Letterbox の余白は ignoreIndex で埋め、損失・評価で無視させる。
                auto maskPreProcessor = preprocessorFactory.forMask(segmentationSpec.ignoreIndex);

                // train だけシャッフルと拡張をする。validation は毎回同じ条件で測るため、どちらもしない。
                // 拡張の設定は固定値(AugmentationConfig の既定値)。
                const bool isTrain = (split == DatasetSplit::Train);
                std::shared_ptr<ISegmentationAugmenter> augmenter;
                if (isTrain)
                {
                    augmenter = std::make_shared<OpenCvSegmentationAugmenter>(AugmentationConfig{}, segmentationSpec.ignoreIndex);
                }

                return std::make_shared<SegmentationDatasetRepository>(timedSource, imagePreProcessor, maskPreProcessor, _trainParam, _parallelExecutor,
                                                                       isTrain, augmenter, _dataSeed);
            },
            [](const ObjectDetectionSpec &) -> std::shared_ptr<IDatasetRepository>
            {
                throw std::runtime_error("VOC 構成のデータセット: ObjectDetection はまだ対応していません");
            },
            [](const ClassificationSpec &) -> std::shared_ptr<IDatasetRepository>
            {
                throw std::runtime_error("VOC 構成のデータセット: Classification はまだ対応していません");
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
