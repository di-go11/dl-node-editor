#include "training/infrastructure/image/ColorMaskLabelConverter.hpp"
#include "training/entities/image/RgbColor.hpp"
#include <stdexcept>
#include <utility>
#include <vector>

ColorMaskLabelConverter::ColorMaskLabelConverter(const ColorLabelMap &labelMap)
{
    for (const ColorClassEntry &entry : labelMap.getEntries())
    {
        const uint32_t key = (uint32_t(entry.color.getR()) << 16) |
                             (uint32_t(entry.color.getG()) << 8) |
                             uint32_t(entry.color.getB());
        _keys.push_back(key);
        _classIds.push_back(static_cast<uint8_t>(entry.classId));
    }
}

ImageData ColorMaskLabelConverter::convert(const ImageData &colorMask) const
{
    const size_t channels = colorMask.getChannels();
    if (channels != 3)
    {
        throw std::invalid_argument("ColorMaskLabelConverter expects a 3-channel (RGB) ImageData");
    }

    const size_t pixelCount = colorMask.getHeight() * colorMask.getWidth();

    // CHW形式より、r, g, bの各チャンネルの先頭ポインタを取得
    const uint8_t *r = colorMask.raw().data();
    const uint8_t *g = r + pixelCount;
    const uint8_t *b = g + pixelCount;

    // 変換後は色ではなくクラスIDの1チャンネル画像になる。
    // ImageDataは生成時にshapeとサイズ整合が固定されるため、
    // ローカルバッファに書き込んでから最後に構築する。
    std::vector<uint8_t> values(pixelCount);

    uint32_t lastKey = 0xFFFFFFFF; // 初期値は存在しないRGB値
    uint8_t lastClassId = 255;     // 初期値は存在しないクラスID

    for (size_t i = 0; i < pixelCount; ++i)
    {
        const uint32_t key = (uint32_t(r[i]) << 16) | (uint32_t(g[i]) << 8) | uint32_t(b[i]);

        if (key != lastKey)
        {
            lastClassId = lookupClassId(key);
            lastKey = key;
        }

        values[i] = lastClassId;
    }

    return ImageData({1, colorMask.getHeight(), colorMask.getWidth()}, std::move(values));
}

uint8_t ColorMaskLabelConverter::lookupClassId(const uint32_t key) const
{
    for (size_t i = 0; i < _keys.size(); ++i)
    {
        if (_keys[i] == key)
        {
            return _classIds[i];
        }
    }
    return 255; // Not found, default to class ID 255
}