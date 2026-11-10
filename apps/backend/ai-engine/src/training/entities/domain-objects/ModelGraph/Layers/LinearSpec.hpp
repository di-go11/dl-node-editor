#pragma once

#include <cstdint>

struct LinearSpec
{
    int64_t inFeatures = 1;
    int64_t outFeatures = 1;
    bool bias = true;
};
