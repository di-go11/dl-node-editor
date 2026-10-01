#include "SeedApplier.hpp"

#include <torch/torch.h>

void SeedApplier::apply(uint64_t seed) const
{
    torch::manual_seed(seed);
}
