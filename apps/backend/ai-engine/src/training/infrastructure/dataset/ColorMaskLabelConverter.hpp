#pragma once

#include "training/entities/domain-objects/ImageData.hpp"
#include "training/entities/segmentation/ColorLabelMap.hpp"

class ColorMaskLabelConverter
{
public:
    ColorMaskLabelConverter(const ColorLabelMap &labelMap);
    ImageData convert(const ImageData &colorMask);

private:
    ColorLabelMap _labelMap;
};