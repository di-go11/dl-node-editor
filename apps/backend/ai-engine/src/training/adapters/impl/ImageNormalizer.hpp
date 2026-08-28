#pragma once

#include "training/entities/domain-objects/ImageData.hpp"
#include "training/entities/domain-objects/NormalizedImageData.hpp"

// OpenCvImageDecoder等が返す0-255範囲の生の値(uint8_t)を持つImageDataを、
// 0.0-1.0範囲に正規化したNormalizedImageDataへ変換する。
// 入力画像(input)には適用し、クラスIDを保持するマスク(target)には適用しないこと。
class ImageNormalizer
{
public:
    static NormalizedImageData normalize(const ImageData &image);
};
