#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "training/entities/image/ColorClassEntry.hpp"

class RgbColor;

class ColorLabelMap
{
public:
    void addEntry(const RgbColor &color, int classId);
    int resolveClassId(const RgbColor &color /*アノテーションではなく対象画像の1ピクセル事のrgbデータ*/) const;

    // 登録エントリ数(= クラス数)。モデル出力チャンネル数の決定などに使う。
    size_t entryCount() const;

private:
    std::vector<ColorClassEntry> _entries;
};