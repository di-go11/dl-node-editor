#pragma once
#include <cstdint>
#include <vector>

struct RgbColor
{
    uint8_t r;
    uint8_t g;
    uint8_t b;
};

struct ColorClassEntry
{
    RgbColor color;
    int classId;
};

class ColorLabelMap
{
public:
    void addEntry(const RgbColor &color, int classId);
    int resolveClassId(const RgbColor &color) const;

private:
    std::vector<ColorClassEntry> _entries;
};