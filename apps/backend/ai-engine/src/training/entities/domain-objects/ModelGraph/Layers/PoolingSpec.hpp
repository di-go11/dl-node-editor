#pragma once

#include <cstdint>

#include "PoolingType.hpp"

struct PoolingSpec
{
    PoolingType type = PoolingType::Max;
    int64_t kernelSize = 2;
    int64_t stride = 2;
    int64_t padding = 0;
};
