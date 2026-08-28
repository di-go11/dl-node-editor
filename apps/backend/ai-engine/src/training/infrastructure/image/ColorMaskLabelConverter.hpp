#pragma once

#include "training/entities/image/ImageData.hpp"
#include "training/entities/image/ColorLabelMap.hpp"

class ColorMaskLabelConverter
{
public:
    ColorMaskLabelConverter(const ColorLabelMap &labelMap);
    ImageData convert(const ImageData &colorMask);

private:
    ColorLabelMap _labelMap;
};