#include "training/infrastructure/image/ColorMaskLabelConverter.hpp"
#include "training/entities/image/RgbColor.hpp"
#include <stdexcept>
#include <utility>
#include <vector>

ColorMaskLabelConverter::ColorMaskLabelConverter(const ColorLabelMap &labelMap) : _labelMap(labelMap) {}

ImageData ColorMaskLabelConverter::convert(const ImageData &colorMask) const
{
    const size_t channels = colorMask.getChannels();
    const size_t height = colorMask.getHeight();
    const size_t width = colorMask.getWidth();

    if (channels != 3)
    {
        throw std::invalid_argument("ColorMaskLabelConverter expects a 3-channel (RGB) ImageData");
    }

    // 変換後は色ではなくクラスIDの1チャンネル画像になる。
    // ImageDataは生成時にshapeとサイズ整合が固定されるため、
    // ローカルバッファに書き込んでから最後に構築する。
    std::vector<uint8_t> values(height * width);

    for (size_t y = 0; y < height; ++y)
    {
        for (size_t x = 0; x < width; ++x)
        {
            RgbColor pixelColor(
                colorMask.at(0, y, x),
                colorMask.at(1, y, x),
                colorMask.at(2, y, x));

            const int classId = _labelMap.resolveClassId(pixelColor);

            // classIdは0-255に収まる想定(256クラスを超える場合はvaluesの型を見直す必要がある)
            values[y * width + x] = static_cast<uint8_t>(classId);
        }
    }

    return ImageData({1, height, width}, std::move(values));
}
