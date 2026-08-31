#pragma once

#include "training/entities/image/LetterboxAnchor.hpp"

#include <cstdint>

struct LetterboxPolicy
{
    uint8_t paddingValue = 0; // 余白の画素値
    LetterboxAnchor anchor = LetterboxAnchor::Center;
    bool allowUpscale = true;
};