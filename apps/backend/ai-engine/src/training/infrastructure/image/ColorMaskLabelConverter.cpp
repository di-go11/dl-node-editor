#include "training/infrastructure/image/ColorMaskLabelConverter.hpp"
#include "training/entities/image/RgbColor.hpp"
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace
{
    std::string describeKey(const uint32_t key)
    {
        return "(" + std::to_string((key >> 16) & 0xFF) + "," + std::to_string((key >> 8) & 0xFF) + "," +
               std::to_string(key & 0xFF) + ")";
    }
} // namespace

uint32_t ColorMaskLabelConverter::toKey(const uint8_t r, const uint8_t g, const uint8_t b)
{
    return (uint32_t(r) << 16) | (uint32_t(g) << 8) | uint32_t(b);
}

ColorMaskLabelConverter::ColorMaskLabelConverter(const ColorLabelMap &labelMap,
                                                 const uint8_t ignoreIndex,
                                                 const std::optional<RgbColor> ignoreColor)
    : _ignoreIndex(ignoreIndex)
{
    for (const ColorClassEntry &entry : labelMap.getEntries())
    {
        _keys.push_back(toKey(entry.color.getR(), entry.color.getG(), entry.color.getB()));
        _classIds.push_back(static_cast<uint8_t>(entry.classId));
    }

    if (ignoreColor.has_value())
    {
        const uint32_t ignoreKey = toKey(ignoreColor->getR(), ignoreColor->getG(), ignoreColor->getB());
        if (const auto classId = lookupClassId(ignoreKey); classId.has_value())
        {
            // 同じ色を「クラス」と「無視」の両方に割り当てると、どちらが優先か分からなくなる。
            throw std::invalid_argument("ignore_color " + describeKey(ignoreKey) +
                                        " が labelmap のクラス " + std::to_string(*classId) + " の色と同じです");
        }
        _ignoreKey = ignoreKey;
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

    // 同じ色が続くことが多いので、直前の色の結果を使い回す。
    // 初期値の 0xFFFFFFFF は 24bit の RGB では現れないキー。
    uint32_t lastKey = 0xFFFFFFFF;
    uint8_t lastClassId = 0;

    for (size_t i = 0; i < pixelCount; ++i)
    {
        const uint32_t key = toKey(r[i], g[i], b[i]);

        if (key != lastKey)
        {
            if (const auto classId = lookupClassId(key); classId.has_value())
            {
                lastClassId = *classId;
            }
            else if (_ignoreKey.has_value() && key == *_ignoreKey)
            {
                lastClassId = _ignoreIndex;
            }
            else
            {
                const size_t y = i / colorMask.getWidth();
                const size_t x = i % colorMask.getWidth();
                throw UnknownMaskColorError("labelmap にない色 " + describeKey(key) + " があります(x=" +
                                            std::to_string(x) + ", y=" + std::to_string(y) +
                                            ")。labelmap.txt に追加するか、無視する色に指定してください");
            }
            lastKey = key;
        }

        values[i] = lastClassId;
    }

    return ImageData({1, colorMask.getHeight(), colorMask.getWidth()}, std::move(values));
}

std::optional<uint8_t> ColorMaskLabelConverter::lookupClassId(const uint32_t key) const
{
    for (size_t i = 0; i < _keys.size(); ++i)
    {
        if (_keys[i] == key)
        {
            return _classIds[i];
        }
    }
    return std::nullopt;
}
