#pragma once

#include "training/entities/domain-objects/BatchData.hpp"
#include "training/entities/image/ImageData.hpp"
#include "training/entities/image/NormalizedImageData.hpp"

struct TrainingBatch
{
    BatchData<NormalizedImageData> input; // 正規化済みの入力画像
    BatchData<ImageData> target;          // クラスIDを保持するマスク(正規化しない)
};
