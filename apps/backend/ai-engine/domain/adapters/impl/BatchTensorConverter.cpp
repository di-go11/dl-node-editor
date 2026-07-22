#include "./BatchTensorConverter.hpp"

#include "../../entities/domain-objects/BatchData.hpp"

#include <stdexcept>

std::vector<float> BatchTensorConverter::flattenValues(const BatchData &batchData)
{
    std::vector<float> flattened;

    for (const auto &row : batchData.values)
    {
        flattened.insert(flattened.end(), row.values.begin(), row.values.end());
    }

    return flattened;
}

std::vector<int64_t> BatchTensorConverter::resolveShape(const BatchData &batchData, std::size_t valueCount)
{
    if (!batchData.shape.empty())
    {
        std::vector<int64_t> resolvedShape;
        resolvedShape.reserve(batchData.shape.size());

        std::size_t shapeProduct = 1;
        for (const auto dimension : batchData.shape)
        {
            resolvedShape.push_back(static_cast<int64_t>(dimension));
            shapeProduct *= dimension;
        }

        if (shapeProduct != valueCount)
        {
            throw std::invalid_argument("BatchData.shape does not match values size");
        }

        return resolvedShape;
    }

    if (batchData.values.empty())
    {
        throw std::invalid_argument("BatchData.values is empty");
    }

    const auto firstRowSize = batchData.values.front().values.size();
    for (const auto &row : batchData.values)
    {
        if (row.values.size() != firstRowSize)
        {
            throw std::invalid_argument("BatchData.values must be rectangular when shape is omitted");
        }
    }

    return {
        static_cast<int64_t>(batchData.values.size()),
        static_cast<int64_t>(firstRowSize),
    };
}

torch::Tensor BatchTensorConverter::convert(const BatchData &batchData) const
{
    const auto flattenedValues = flattenValues(batchData);
    const auto resolvedShape = resolveShape(batchData, flattenedValues.size());

    return torch::tensor(flattenedValues, torch::TensorOptions().dtype(torch::kFloat32)).reshape(resolvedShape);
}
