#pragma once

#include <torch/torch.h>

#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

#include "training/entities/domain-objects/BatchData.hpp"
#include "training/entities/image/ImageData.hpp"
#include "training/entities/image/NormalizedImageData.hpp"

// BatchData<TSample> を [N, C, H, W] の float テンソルへ変換する。
// TSample は ImageData(uint8) と NormalizedImageData(float)の両方に対応。
class BatchTensorConverter
{
public:
    template <typename TSample>
    torch::Tensor convert(const BatchData<TSample> &batchData) const
    {
        const std::vector<float> flattened = flattenValues(batchData);
        const std::vector<int64_t> resolvedShape = resolveShape(batchData, flattened.size());

        return torch::tensor(flattened, torch::TensorOptions().dtype(torch::kFloat32))
            .reshape(resolvedShape);
    }

private:
    // --- サンプル型に依らず「形状」「値列」を取り出すためのアクセサ ---
    // ImageData は raw()/shape() メソッド、NormalizedImageData は values/shape メンバ。
    static const std::vector<std::size_t> &sampleShape(const ImageData &sample)
    {
        return sample.shape();
    }
    static const std::vector<std::size_t> &sampleShape(const NormalizedImageData &sample)
    {
        return sample.shape;
    }

    static void appendValues(std::vector<float> &out, const ImageData &sample)
    {
        for (uint8_t value : sample.raw())
        {
            out.push_back(static_cast<float>(value));
        }
    }
    static void appendValues(std::vector<float> &out, const NormalizedImageData &sample)
    {
        out.insert(out.end(), sample.values.begin(), sample.values.end());
    }

    static std::size_t sampleValueCount(const ImageData &sample)
    {
        return sample.raw().size();
    }
    static std::size_t sampleValueCount(const NormalizedImageData &sample)
    {
        return sample.values.size();
    }

    template <typename TSample>
    static std::vector<float> flattenValues(const BatchData<TSample> &batchData)
    {
        std::vector<float> flattened;
        for (const auto &sample : batchData.values)
        {
            appendValues(flattened, sample);
        }
        return flattened;
    }

    template <typename TSample>
    static std::vector<int64_t> resolveShape(const BatchData<TSample> &batchData, std::size_t valueCount)
    {
        if (batchData.values.empty())
        {
            throw std::invalid_argument("BatchData.values is empty");
        }

        const std::vector<std::size_t> &firstShape = sampleShape(batchData.values.front());

        if (!firstShape.empty())
        {
            std::vector<int64_t> resolvedShape;
            resolvedShape.reserve(firstShape.size() + 1);
            resolvedShape.push_back(static_cast<int64_t>(batchData.values.size())); // N

            std::size_t shapeProduct = 1;
            for (const auto dimension : firstShape)
            {
                resolvedShape.push_back(static_cast<int64_t>(dimension));
                shapeProduct *= dimension; // C * H * W
            }

            shapeProduct *= batchData.values.size();
            if (shapeProduct != valueCount)
            {
                throw std::invalid_argument("sample shape does not match values size");
            }

            return resolvedShape;
        }

        // shape 省略時: 各サンプルの値列サイズが揃っていることだけ確認する。
        const std::size_t firstRowSize = sampleValueCount(batchData.values.front());
        for (const auto &sample : batchData.values)
        {
            if (sampleValueCount(sample) != firstRowSize)
            {
                throw std::invalid_argument("BatchData.values must be rectangular when shape is omitted");
            }
        }

        return {
            static_cast<int64_t>(batchData.values.size()),
            static_cast<int64_t>(firstRowSize),
        };
    }
};
