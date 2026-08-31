#pragma once

#include "training/entities/image/InterpolationMethod.hpp"
#include "training/entities/image/AspectRatioPolicy.hpp"

#include <cstdint>

struct ResizeParam
{
    uint16_t width;
    uint16_t height;

    InterpolationMethod interpolationMethod = InterpolationMethod::Auto;
    AspectRatioPolicy aspectRatioPolicy = WarpPolicy{}; // デフォルトコンストラクタは先頭の代替型をデフォルト構築するため、変数宣言だけでもWarpPolicyを持つが、意図を明示するために一旦WarpPolicy{}を宣言
};