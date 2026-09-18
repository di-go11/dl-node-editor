#pragma once

#include <cstdint>

struct Conv2DParams
{
    int64_t inChannels = 1;
    int64_t outChannels = 1;
    int64_t kernelSize = 3;
    int64_t stride = 1;
    int64_t padding = 0;

    int64_t dilation = 1;
};
