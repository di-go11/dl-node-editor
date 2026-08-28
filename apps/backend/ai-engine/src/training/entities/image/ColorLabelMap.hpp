#pragma once

#include <cstdint>
#include <vector>

#include "training/entities/image/ColorClassEntry.hpp"

class RgbColor;

class ColorLabelMap
{
public:
    void addEntry(const RgbColor &color, int classId);
    int resolveClassId(const RgbColor &color /*アノテーションではなく対象画像の1ピクセル事のrgbデータ*/) const;

private:
    std::vector<ColorClassEntry> _entries;
};