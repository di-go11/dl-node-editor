#pragma once

#include "training/entities/domain-objects/ImageData.hpp"
#include <string>

class IImageDecoder
{
public:
    virtual ~IImageDecoder() = default;

    // 画像ファイルをデコードしてImageDataに返す
    // 事前条件: ImagePathは読み取り可能な画像ファイルを指していること
    // 事後条件: 戻り値の値配列はRGB順・CHQ形式であることを実装側が保証すること(OpencvはBGRで返すため用変換)
    virtual ImageData decode(const std::string &imagePath) = 0;
};