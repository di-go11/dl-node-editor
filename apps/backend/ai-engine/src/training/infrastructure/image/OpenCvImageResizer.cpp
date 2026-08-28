#include "training/infrastructure/image/OpenCvImageResizer.hpp"

#include <opencv2/opencv.hpp>

OpenCvImageResizer::OpenCvImageResizer(const uint16_t &width, const uint16_t &height) : _width(width), _height(height)
{
}

ImageData OpenCvImageResizer::process(const ImageData &rowImage) const
{
    CV result;
    result.shape = {
        static_cast<size_t>(rowImage.shape[0]), //[0]はchannelsであることを保証されている必要がある。
        static_cast<size_t>(_height),
        static_cast<size_t>(_width)};

    cv::resize(
        rowImage.values,
        result.values,
        cv::Size(_width, _height),
        0,
        0,
        cv::INTER_LINEAR);
}