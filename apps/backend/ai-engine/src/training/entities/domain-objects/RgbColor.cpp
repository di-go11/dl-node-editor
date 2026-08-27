#include "training/entities/domain-objects/RgbColor.hpp"

RgbColor::RgbColor(uint8_t r, uint8_t g, uint8_t b)
    : _r(r), _g(g), _b(b)
{
    _rgbData = {r, g, b};
}

uint8_t RgbColor::getB() const
{
    return _b;
}

uint8_t RgbColor::getG() const
{
    return _g;
}

uint8_t RgbColor::getR() const
{
    return _r;
}

std::vector<uint8_t> RgbColor::getColorData() const
{
    return _rgbData;
}