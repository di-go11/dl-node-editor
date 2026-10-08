#pragma once

#include <cstdint>
#include "UpsampleMode.hpp"

struct UpsampleSpec
{
    UpsampleMode upsampleMode = UpsampleMode::Nearest; // 補完方法
    int64_t scaleFactor = 2;                           // 縦横の倍率(1以上)
};