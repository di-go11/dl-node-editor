#pragma once

#include "training/entities/image/ImageData.hpp"
#include "training/entities/image/ColorLabelMap.hpp"
#include "training/entities/image/RgbColor.hpp"

#include <cstdint>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

// マスク画像に、labelmap にも ignoreColor にもない色があったときの例外。
class UnknownMaskColorError : public std::runtime_error
{
public:
    using std::runtime_error::runtime_error;
};

// カラーのマスク画像(RGB)を、クラス ID の 1 チャンネル画像に変換する。
//   labelmap の色        → そのクラス ID
//   ignoreColor の色     → ignoreIndex(損失・評価で無視される)
//   それ以外の色         → UnknownMaskColorError
// 未知の色を黙って無視すると、labelmap の色の書き間違いなどで「あるクラスだけ学習されない」
// 気付きにくい失敗になるため、エラーにしている。
class ColorMaskLabelConverter
{
public:
    // ignoreColor が labelmap のどれかの色と同じなら std::invalid_argument。
    ColorMaskLabelConverter(const ColorLabelMap &labelMap,
                            uint8_t ignoreIndex = 255,
                            std::optional<RgbColor> ignoreColor = std::nullopt);
    ImageData convert(const ImageData &colorMask) const;

private:
    static uint32_t toKey(uint8_t r, uint8_t g, uint8_t b);
    std::optional<uint8_t> lookupClassId(uint32_t key) const;

    std::vector<uint32_t> _keys;    // RGBを32bit整数に変換した値のキャッシュ
    std::vector<uint8_t> _classIds; // RGBに対応するクラスIDのキャッシュ
    uint8_t _ignoreIndex;
    std::optional<uint32_t> _ignoreKey; // ignoreColor のキー(未指定なら nullopt)
};
