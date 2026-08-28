#include "training/adapters/impl/image/ImageResizer.hpp"

ImageResizer::ImageResizer(const uint16_t &width, const uint16_t &height) : _width(width), _height(height)
{
}

ImageData ImageResizer::process(const ImageData &rowImage) const
{
    ImageData result;
    result.shape = {
        static_cast<size_t>(rowImage.shape[0]), //[0]はchannelsであることを保証されている必要がある。
        static_cast<size_t>(_height),
        static_cast<size_t>(_width)};
}