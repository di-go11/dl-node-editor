#pragma once

#include "training/application/interfaces/ICapabilityProvider.hpp"

class CudaCapabilityProvider final : public ICapabilityProvider
{
public:
    CapabilitySnapshot snapshot() const override;
};