#include "training/infrastructure/torchFunc/TorchLossFactory.hpp"

// ---loss functions---
#include "training/infrastructure/torchFunc/CrossEntropy.hpp"
#include "training/infrastructure/torchFunc/MseLoss.hpp"
#include "training/infrastructure/torchFunc/DiceLoss.hpp"
#include "training/infrastructure/torchFunc/FocalLoss.hpp"
#include "training/infrastructure/torchFunc/ComboLoss.hpp"
#include "training/infrastructure/torchFunc/BoundaryLoss.hpp"

#include <variant>

namespace
{
    // TorchLayerBuilder と同じ、variant を型ごとに分岐させるための補助。
    template <class... Ts>
    struct Overloaded : Ts...
    {
        using Ts::operator()...;
    };
    template <class... Ts>
    Overloaded(Ts...) -> Overloaded<Ts...>;
}

std::shared_ptr<ILoss> TorchLossFactory::create(const LossConfig &config, const int64_t ignoreIndex)
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
            [&](const DiceLossConfig &c) -> std::shared_ptr<ILoss>
            {
                return std::make_shared<DiceLoss>(c.numClasses, ignoreIndex);
            },
            [&](const FocalLossConfig &c) -> std::shared_ptr<ILoss>
            {
                return std::make_shared<FocalLoss>(c.numClasses, c.gamma, c.alpha, ignoreIndex);
            },
            [&](const ComboLossConfig &c) -> std::shared_ptr<ILoss>
            {
                return std::make_shared<ComboLoss>(c.numClasses, c.alpha, ignoreIndex);
            },
            [&](const BoundaryLossConfig &c) -> std::shared_ptr<ILoss>
            {
                return std::make_shared<BoundaryLoss>(c.numClasses, ignoreIndex);
            }},
        config);
}