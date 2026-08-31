#pragma once

#include "training/entities/image/ImageData.hpp"

class IImagePreprocessor
{
public:
    virtual ~IImagePreprocessor() = default;
    virtual ImageData process(const ImageData &rowImage) const = 0;
};