#pragma once

#include "training/application/interfaces/image/IImagePreprocessor.hpp"

class OpenCvImageResizer : public IImagePreprocessor
{
public:
    OpenCvImageResizer(const uint16_t &width, const uint16_t &height);
    ImageData process(const ImageData &rowImage) const override;

private:
    const uint16_t _width;
    const uint16_t _height;
};