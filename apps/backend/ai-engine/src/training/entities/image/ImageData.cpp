#include "training/entities/image/ImageData.hpp"
#include <stdexcept>

ImageData::ImageData(std::vector<size_t> shape, std::vector<uint8_t> values)
    : _shape(std::move(shape)), _values(std::move(values))
{
    if (_shape.size() != 3)
    {
        throw std::invalid_argument("ImageData: shape must have 3 dimensions (channels, height, width)");
    }
    if (_values.size() != _shape[0] * _shape[1] * _shape[2])
    {
        throw std::invalid_argument("ImageData: values size does not match shape");
    }
}

size_t ImageData::getChannels() const
{
    return _shape[0];
}

size_t ImageData::getHeight() const
{
    return _shape[1];
}

size_t ImageData::getWidth() const
{
    return _shape[2];
}

uint8_t ImageData::at(size_t channel, size_t y, size_t x) const
{
    return _values[index(channel, y, x)];
}

uint8_t &ImageData::at(size_t channel, size_t y, size_t x)
{
    return _values[index(channel, y, x)];
}

const std::vector<uint8_t> &ImageData::raw() const
{
    return _values;
}

const std::vector<size_t> &ImageData::shape() const
{
    return _shape;
}

size_t ImageData::index(size_t channel, size_t y, size_t x) const
{
    return channel * getHeight() * getWidth() + y * getWidth() + x;
}