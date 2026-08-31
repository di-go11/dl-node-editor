#include "training/infrastructure/dataset/VocColorLabelMapFactory.hpp"
#include "training/entities/image/RgbColor.hpp"

namespace
{
    // PASCAL VOC devkitの標準カラーマップ生成アルゴリズム。
    // クラスIDのビットをR/G/Bに1ビットずつ振り分けて色を決める。
    RgbColor vocColorAt(int classId)
    {
        uint8_t r = 0, g = 0, b = 0;
        int c = classId;
        for (int j = 0; j < 8; ++j)
        {
            r = static_cast<uint8_t>(r | (((c >> 0) & 1) << (7 - j)));
            g = static_cast<uint8_t>(g | (((c >> 1) & 1) << (7 - j)));
            b = static_cast<uint8_t>(b | (((c >> 2) & 1) << (7 - j)));
            c >>= 3;
        }
        return RgbColor(r, g, b);
    }
} // namespace

ColorLabelMap VocColorLabelMapFactory::create()
{
    ColorLabelMap labelMap;
    constexpr int kNumClasses = 21; // 0=background + 1-20の物体クラス

    for (int classId = 0; classId < kNumClasses; ++classId)
    {
        labelMap.addEntry(vocColorAt(classId), classId);
    }

    return labelMap;
}
