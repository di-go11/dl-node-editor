#include "training/infrastructure/torchFunc/TorchLossFactory.hpp"

// ---loss functions---
#include "training/infrastructure/torchFunc/CrossEntropy.hpp"
#include "training/infrastructure/torchFunc/MseLoss.hpp"
#include "training/infrastructure/torchFunc/DiceLoss.hpp"
#include "training/infrastructure/torchFunc/FocalLoss.hpp"
#include "training/infrastructure/torchFunc/ComboLoss.hpp"
#include "training/infrastructure/torchFunc/BoundaryLoss.hpp"

#include "training/entities/utils/Overloaded.hpp"

#include <variant>

std::shared_ptr<ILoss> TorchLossFactory::create(const LossConfig &config, const int numClasses, const int64_t ignoreIndex)
{
    return std::visit(
        Overloaded{
            [&](const CrossEntropyConfig &) -> std::shared_ptr<ILoss>
            {
                return std::make_shared<CrossEntropy>(ignoreIndex);
            },
            [](const MseLossConfig &) -> std::shared_ptr<ILoss>
            {
                return std::make_shared<MseLoss>();
            },
            [&](const DiceLossConfig &) -> std::shared_ptr<ILoss>
            {
                return std::make_shared<DiceLoss>(numClasses, ignoreIndex);
            },
            [&](const FocalLossConfig &c) -> std::shared_ptr<ILoss>
            {
                return std::make_shared<FocalLoss>(numClasses, c.gamma, c.alpha, ignoreIndex);
            },
            [&](const ComboLossConfig &c) -> std::shared_ptr<ILoss>
            {
                return std::make_shared<ComboLoss>(numClasses, c.alpha, ignoreIndex);
            },
            [&](const BoundaryLossConfig &) -> std::shared_ptr<ILoss>
            {
                return std::make_shared<BoundaryLoss>(numClasses, ignoreIndex);
            }},
        config);
}