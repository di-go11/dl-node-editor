#include <torch/torch.h>
#include <iostream>
#include <memory>
#include <string>

#include "training/infrastructure/torchFunc/SeedApplier.hpp"

namespace
{
    int failureCount = 0;
    void check(bool condition, const std::string &message)
    {
        std::cout << (condition ? "[PASS] " : "[FAIL] ") << message << std::endl;
        if (!condition)
        {
            ++failureCount;
        }
    }
}

int main()
{
    const auto seedApplier = std::make_unique<SeedApplier>();
    seedApplier->apply(1234567890);
    const torch::Tensor tensor1 = torch::rand({3, 3});

    seedApplier->apply(1234567890);
    const torch::Tensor tensor2 = torch::rand({3, 3});

    check(torch::equal(tensor1, tensor2), "同じシードで同じ乱数が生成される");

    seedApplier->apply(9876543210);
    const torch::Tensor tensor3 = torch::rand({3, 3});

    seedApplier->apply(9876543211);
    const torch::Tensor tensor4 = torch::rand({3, 3});

    check(!torch::equal(tensor3, tensor4), "異なるシードで異なる乱数が生成される");

    return failureCount == 0 ? 0 : 1;
}