#pragma once

#include "training/entities/image/ImageData.hpp"
#include <string>

class IImageDecoder
{
public:
    virtual ~IImageDecoder() = default;

    // 画像ファイルをデコードしてImageDataに返す
    // 事前条件: ImagePathは読み取り可能な画像ファイルを指していること
    // 事後条件: 戻り値の値配列はRGB順・CHW形式であること、値は正規化せず0-255の範囲のままであることを実装側が保証すること
    //           (OpencvはBGRで返すため用変換。0.0-1.0への正規化は用途(input/mask)によって要否が異なるため、
    //            ここでは行わずImageNormalizer側の責務とする)
    virtual ImageData decode(const std::string &imagePath) = 0;
};