#include "training/infrastructure/image/ResizePreprocessorFactory.hpp"

#include "training/entities/image/ResizeParam.hpp"
#include "training/infrastructure/image/OpenCvImageResizer.hpp"

#include <optional>
#include <utility>
#include <variant>

namespace
{
// ジオメトリを共有しつつ、補間方法と(Letterbox の)パディング値だけ差し替えた ResizeParam を作る。
ResizeParam buildParam(
    const ResizePreprocessorFactory::Geometry &geometry,
    InterpolationMethod interpolation,
    std::optional<uint8_t> paddingOverride)
{
    ResizeParam param;
    param.width = geometry.width;
    param.height = geometry.height;
    param.interpolationMethod = interpolation;
    param.aspectRatioPolicy = geometry.aspectRatioPolicy; // ジオメトリはそのままコピー

    // Letterbox のときだけ、余白値を用途別の値へ上書きする。
    if (paddingOverride)
    {
        if (auto *letterbox = std::get_if<LetterboxPolicy>(&param.aspectRatioPolicy))
        {
            letterbox->paddingValue = *paddingOverride;
        }
    }

    return param;
}
} // namespace

ResizePreprocessorFactory::ResizePreprocessorFactory(Geometry geometry)
    : _geometry(std::move(geometry))
{
}

std::shared_ptr<IImagePreprocessor> ResizePreprocessorFactory::forImage(
    InterpolationMethod interpolation) const
{
    return std::make_shared<OpenCvImageResizer>(
        buildParam(_geometry, interpolation, std::nullopt));
}

std::shared_ptr<IImagePreprocessor> ResizePreprocessorFactory::forMask(uint8_t ignoreIndex) const
{
    return std::make_shared<OpenCvImageResizer>(
        buildParam(_geometry, InterpolationMethod::NearestNeighbor, ignoreIndex));
}
