#include "training/entities/image/RgbColor.hpp"

std::vector<uint8_t> RgbColor::getColorData() const
{
    return std::vector<uint8_t>{_r, _g, _b};
}