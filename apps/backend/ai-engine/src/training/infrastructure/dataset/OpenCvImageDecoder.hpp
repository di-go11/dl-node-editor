#pragma once

#include "training/application/interfaces/IImageDecoder.hpp"

class OpenCvImageDecoder : public IImageDecoder
{
public:
    OpenCvImageDecoder();
    ImageData decode(const std::string &imagePath) override;
};
