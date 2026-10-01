#pragma once

#include <cstdint>

struct UnpoolingParams
{
    int64_t kernelSize = 2;
    int64_t stride = 2;
    int64_t padding = 0;
};