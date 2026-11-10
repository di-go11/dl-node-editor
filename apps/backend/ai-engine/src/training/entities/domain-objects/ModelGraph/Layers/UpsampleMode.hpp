#pragma once

enum class UpsampleMode
{
    Nearest,  // 近い画素をそのまま写す
    Bilinear, // 周囲の4画素から計算
};