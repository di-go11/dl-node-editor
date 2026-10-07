#pragma once

#include <cstdint>

struct BatchNormSpec
{
    int64_t numFeatures = 1;
    double eps = 1e-5;
    double momentum = 0.1;
};
