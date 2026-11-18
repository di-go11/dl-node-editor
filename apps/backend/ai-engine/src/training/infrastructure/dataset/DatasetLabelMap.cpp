#include "training/infrastructure/dataset/DatasetLabelMap.hpp"

#include "training/entities/utils/Overloaded.hpp"
#include "training/infrastructure/dataset/LabelMapFileReader.hpp"
#include "training/infrastructure/dataset/VocColorLabelMapFactory.hpp"

#include <filesystem>
#include <variant>

ColorLabelMap loadDatasetLabelMap(const ImageAnnotationConfig &annotation, const std::string &datasetPath)
{
    return std::visit(
        Overloaded{
            [](const PascalVocConfig &) -> ColorLabelMap
            {
                return VocColorLabelMapFactory::create();
            },
            [&](const OriginalConfig &) -> ColorLabelMap
            {
                return LabelMapFileReader{}.read((std::filesystem::path(datasetPath) / "labelmap.txt").string());
            },
        },
        annotation);
}
