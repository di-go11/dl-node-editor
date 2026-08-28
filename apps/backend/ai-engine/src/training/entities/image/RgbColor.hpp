#pragma once
#include <cstdint>
#include <vector>

class RgbColor
{
public:
    RgbColor(uint8_t r, uint8_t g, uint8_t b);

    uint8_t getR() const;
    uint8_t getG() const;
    uint8_t getB() const;
    std::vector<uint8_t> getColorData() const;

private:
    uint8_t _r;
    uint8_t _g;
    uint8_t _b;
    std::vector<uint8_t> _rgbData;
};