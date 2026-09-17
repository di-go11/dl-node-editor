#pragma once

#include <cstdint>

struct UnpoolingParams
{
    int64_t kernelSize;
    int64_t stride;
    int64_t padding;
};