#include "training/application/impl/image/ImageNormalizer.hpp"

NormalizedImageData ImageNormalizer::normalize(const ImageData &image)
{
    const std::vector<uint8_t> &src = image.raw();

    NormalizedImageData result;
    result.shape = image.shape();
    result.values.resize(src.size());

    for (size_t i = 0; i < src.size(); ++i)
    {
        result.values[i] = static_cast<float>(src[i]) / 255.0f;
    }

    return result;
}
