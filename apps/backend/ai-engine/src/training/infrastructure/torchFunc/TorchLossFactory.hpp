#pragma once

#include "training/adapters/interfaces/ILossFactory.hpp"

class TorchLossFactory : public ILossFactory
{
public:
    std::shared_ptr<ILoss> create(const LossConfig &config, int numClasses, int64_t ignoreIndex) override;
};