#pragma once

#include <cstdint>
#include "UpsampleMode.hpp"

struct UpsampleSpec
{
    int64_t scaleFactor = 2;                           // 縦横の倍率(1以上)
    UpsampleMode upsampleMode = UpsampleMode::Nearest; // 補完方法
};