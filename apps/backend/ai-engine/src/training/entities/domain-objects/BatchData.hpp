#pragma once

#include <vector>
#include "training/entities/image/ImageData.hpp"

struct BatchData
{
    std::vector<ImageData> values;
    int num_samples;
};