#pragma once

#include "training/entities/image/InterpolationMethod.hpp"
#include "training/entities/image/ResizePolicy.hpp"

#include <cstdint>

struct ResizeParam
{
    uint16_t width;
    uint16_t height;

    InterpolationMethod interpolationMethod = InterpolationMethod::Auto;
    ResizePolicy resizePolicy = ResizePolicy::Warp;
};