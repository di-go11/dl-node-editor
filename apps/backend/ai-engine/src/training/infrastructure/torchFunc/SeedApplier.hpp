#pragma once

#include "training/adapters/interfaces/ISeed.hpp"
#include <cstdint>

class SeedApplier : public ISeed
{
public:
    void apply(uint64_t seed) const override;
};