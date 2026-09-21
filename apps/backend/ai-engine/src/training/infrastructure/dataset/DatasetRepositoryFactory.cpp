#include "DatasetRepositoryFactory.hpp"

#include "training/entities/domain-objects/Tasks/ImageTaskType.hpp"

#include <exception>
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

std::shared_ptr<IDatasetRepository> DatasetRepositoryFactory::create(const TrainingTaskType &taskType, const DatasetConfig &config, DatasetSplit split) const
{
    return std::visit(
        Overloaded{
            [&](const PascalVocConfig &annotationConfig) -> std::shared_ptr<IDatasetRepository>
            {
                switch (std::get<ImageTaskType>(taskType))
                {
                case ImageTaskType::SEMANTIC_SEGMENTATION:
                    return std::make_shared<Voc>(config.datasetPath, split, annotationConfig);
                default:
                    throw std::runtime_error("Unsupported ImageTaskType for PascalVocConfig");
                }
            },
        },
        config.annotationConfig, taskType)
}