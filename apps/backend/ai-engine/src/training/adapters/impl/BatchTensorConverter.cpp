#include "./BatchTensorConverter.hpp"

#include "../../entities/domain-objects/BatchData.hpp"

#include <stdexcept>

std::vector<float> BatchTensorConverter::flattenValues(const BatchData &batchData)
{
    std::vector<float> flattened;

    for (const auto &row : batchData.values)
    {
        for (uint8_t value : row.values)
        {
            flattened.push_back(static_cast<float>(value));
        }
    }

    return flattened;
}
// ImageDataのshapeチェック
std::vector<int64_t> BatchTensorConverter::resolveShape(const BatchData &batchData, std::size_t valueCount)
{
    if (batchData.values.empty())
    {
        throw std::invalid_argument("BatchData.values is empty");
    }

    const auto &firstImage = batchData.values.front(); // values配列の最初の要素を参照(変数にコピーはしない)

    if (!firstImage.shape.empty())
    {
        std::vector<int64_t> resolvedShape;
        resolvedShape.reserve(firstImage.shape.size() + 1);                     // (channels, height, width分の配列サイズ+1の確保) +1は最後尾に画像サイズを入れるため
        resolvedShape.push_back(static_cast<int64_t>(batchData.values.size())); // ベクトル(配列)の末尾(今回は配列の最初の方になる)にvaluesのサイズ(画像の枚数)のデータを保存

        std::size_t shapeProduct = 1;
        for (const auto dimension : firstImage.shape)
        {
            resolvedShape.push_back(static_cast<int64_t>(dimension));
            shapeProduct *= dimension; // 画像のchannels*height*width
        }

        shapeProduct *= batchData.values.size();
        if (shapeProduct != valueCount)
        {
            throw std::invalid_argument("ImageData.shape does not match values size");
        }

        return resolvedShape;
    }

    const auto firstRowSize = firstImage.values.size();
    for (const auto &image : batchData.values)
    {
        if (image.values.size() != firstRowSize)
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
