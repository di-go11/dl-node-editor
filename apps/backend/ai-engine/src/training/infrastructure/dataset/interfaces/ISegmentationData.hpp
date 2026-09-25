#pragma once
#include "training/entities/image/ImageData.hpp"

#include <cstddef>

// セグメンテーション用データソースの抽象。データ形式(VOC, COCO 等)ごとの読み込み方を隠蔽し、
// 利用側(ImageDatasetRepository)はインデックスだけでサンプルを取り出す。
class ISegmentationData
{
public:
    virtual ~ISegmentationData() = default;
    virtual size_t size() const = 0;                     // サンプル数
    virtual ImageData getImage(size_t index) const = 0;  // デコード済み画像(前処理・正規化前)
    virtual ImageData getMask(size_t index) const = 0;   // クラスID化済みマスク(前処理前)
};
