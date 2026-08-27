#include "training/entities/segmentation/ColorClassEntry.hpp"
#include "training/entities/segmentation/ColorLabelMap.hpp"
#include "training/entities/domain-objects/RgbColor.hpp"

// labelmap.txtからカラーとクラスIDの対応を保持する関数
void ColorLabelMap::addEntry(const RgbColor &color, int classId)
{
    ColorClassEntry entry{color, classId};
    _entries.push_back(entry);
}

int ColorLabelMap::resolveClassId(const RgbColor &color) const
{
    for (const ColorClassEntry &entry : _entries)
    {
        if (entry.color.getR() == color.getR() &&
            entry.color.getG() == color.getG() &&
            entry.color.getB() == color.getB())
        {
            return entry.classId;
        }
    }
    return -1; // Not found
}