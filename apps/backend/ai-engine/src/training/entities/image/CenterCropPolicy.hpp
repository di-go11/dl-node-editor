#pragma once

#include "training/entities/image/CropAnchor.hpp"

struct CenterCropPolicy
{
    CropAnchor anchor = CropAnchor::Center; // 切り出し位置
    bool allowUpscale = true;               // cover方向で足りないとき拡大するか?
};
