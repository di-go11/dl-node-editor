#include "training/application/impl/image/ImageNormalizer.hpp"

NormalizedImageData ImageNormalizer::normalize(const ImageData &image)
{
    NormalizedImageData result;
    result.shape = image.shape;
    result.values.resize(image.values.size());

    for (size_t i = 0; i < image.values.size(); ++i)
    {
        result.values[i] = static_cast<float>(image.values[i]) / 255.0f;
    }

    return result;
}
