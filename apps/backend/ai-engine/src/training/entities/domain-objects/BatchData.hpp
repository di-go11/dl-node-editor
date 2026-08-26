#pragma once

#include <vector>
#include "./ImageData.hpp"

struct BatchData
{
    std::vector<ImageData> values;
    int num_samples;
};