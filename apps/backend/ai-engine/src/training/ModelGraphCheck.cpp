#include "training/ModelGraphCheck.hpp"

#include "training/application/interfaces/ITrainingJobManager.hpp"
#include "training/entities/domain-objects/ModelGraph/DAG/GraphShapeInference.hpp"
#include "training/entities/domain-objects/ModelGraph/PortShape.hpp"
#include "training/infrastructure/dataset/DatasetLabelMap.hpp"

#include <cstdint>
#include <exception>
#include <variant>

namespace
{
    // 画像は RGB で読み込むので、グラフ入力のチャンネル数は 3(プリセットの SegNet / U-Net の最初の層と同じ)
    constexpr int64_t kImageChannels = 3;

    int64_t countClasses(const ImageSpec &image, const std::string &datasetPath)
    {
        try
        {
            return static_cast<int64_t>(loadDatasetLabelMap(image.annotation, datasetPath).entryCount());
        }
        catch (const std::exception &e)
        {
            throw DatasetUnreadableError("データセットの色表を読めないため、クラス数が分かりません: " +
                                         datasetPath + " (" + e.what() + ")");
        }
    }
}

std::vector<GraphValidationError> checkModelGraph(const ModelGraph &graph,
                                                  const DataSpec &dataSpec,
                                                  const std::string &datasetPath)
{
    std::vector<GraphValidationError> structureErrors = validateGraphStructure(graph);
    if (!structureErrors.empty())
    {
        return structureErrors;
    }

    // 構造に問題がないので、create は例外を投げない(実行順を求めるために使う)
    const ValidatedModelGraph validated = ValidatedModelGraph::create(graph);

    const ImageSpec &image = std::get<ImageSpec>(dataSpec);
    const FeatureMapShape input{kImageChannels,
                                static_cast<int64_t>(image.inputHeight),
                                static_cast<int64_t>(image.inputWidth)};

    if (std::holds_alternative<SegmentationSpec>(image.taskSpecs))
    {
        return validateGraphShapes(validated, input, countClasses(image, datasetPath));
    }
    return inferGraphShapes(validated, input).errors;
}
