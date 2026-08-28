#include "training/infrastructure/image/ColorMaskLabelConverter.hpp"
#include "training/entities/image/RgbColor.hpp"
#include <stdexcept>

ColorMaskLabelConverter::ColorMaskLabelConverter(const ColorLabelMap &labelMap) : _labelMap(labelMap) {}

ImageData ColorMaskLabelConverter::convert(const ImageData &colorMask)
{
    const size_t channels = colorMask.shape[0];
    const size_t height = colorMask.shape[1];
    const size_t width = colorMask.shape[2];

    if (channels != 3)
    {
        throw std::invalid_argument("ColorMaskLabelConverter expects a 3-channel (RGB) ImageData");
    }

    ImageData result;
    result.shape = {1, height, width}; // 変換後は色ではなくクラスIDの1チャンネル画像になる
    result.values.resize(height * width);

    for (size_t y = 0; y < height; ++y)
    {
        for (size_t x = 0; x < width; ++x)
        {
            const size_t rIndex = 0 * height * width + y * width + x;
            const size_t gIndex = 1 * height * width + y * width + x;
            const size_t bIndex = 2 * height * width + y * width + x;

            RgbColor pixelColor(
                colorMask.values[rIndex],
                colorMask.values[gIndex],
                colorMask.values[bIndex]);

            const int classId = _labelMap.resolveClassId(pixelColor);

            // classIdは0-255に収まる想定(256クラスを超える場合はvaluesの型を見直す必要がある)
            result.values[y * width + x] = static_cast<uint8_t>(classId);
        }
    }

    return result;
}
