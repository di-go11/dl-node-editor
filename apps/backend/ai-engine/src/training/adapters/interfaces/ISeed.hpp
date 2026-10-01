#pragma once

#include <cstdint>

class ISeed
{
public:
    virtual ~ISeed() = default;

    // 乱数シードを適用する。
    virtual void apply(uint64_t seed) const = 0;
};