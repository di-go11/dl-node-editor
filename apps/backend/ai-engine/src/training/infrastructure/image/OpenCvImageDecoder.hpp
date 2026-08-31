#pragma once

#include "training/application/interfaces/image/IImageDecoder.hpp"

class OpenCvImageDecoder : public IImageDecoder
{
public:
    OpenCvImageDecoder();
    ImageData decode(const std::string &imagePath) override;
};
