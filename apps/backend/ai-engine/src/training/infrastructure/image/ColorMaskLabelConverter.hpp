#pragma once

#include "training/entities/image/ImageData.hpp"
#include "training/entities/image/ColorLabelMap.hpp"

class ColorMaskLabelConverter
{
public:
    ColorMaskLabelConverter(const ColorLabelMap &labelMap);
    ImageData convert(const ImageData &colorMask) const;

private:
    uint8_t lookupClassId(const uint32_t key) const;
    std::vector<uint32_t> _keys;    // RGBを32bit整数に変換した値のキャッシュ
    std::vector<uint8_t> _classIds; // RGBに対応するクラスIDのキャッシュ
};