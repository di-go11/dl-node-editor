#pragma once
#include <cstdint>
#include <vector>

class RgbColor
{
public:
    RgbColor(uint8_t r, uint8_t g, uint8_t b) : _r(r), _g(g), _b(b) {}

    uint8_t getR() const
    {
        return _r;
    }
    uint8_t getG() const
    {
        return _g;
    }
    uint8_t getB() const
    {
        return _b;
    }
    std::vector<uint8_t> getColorData() const;

private:
    uint8_t _r;
    uint8_t _g;
    uint8_t _b;
};