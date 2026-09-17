#include "training/infrastructure/torchFunc/TorchLayerBuilder.hpp"
#include "training/adapters/interfaces/ILayer.hpp"

// 各Paramsに対応する具象Layerのヘッダをinclude
#include "training/infrastructure/torchFunc/TorchConv2DLayer.hpp"
#include "training/infrastructure/torchFunc/TorchPoolingLayer.hpp"
#include "training/infrastructure/torchFunc/TorchBatchNormLayer.hpp"
#include "training/infrastructure/torchFunc/TorchLinearLayer.hpp"
#include "training/infrastructure/torchFunc/TorchActivationLayer.hpp"
#include "training/infrastructure/torchFunc/TorchIndexPoolingLayer.hpp"
#include "training/infrastructure/torchFunc/TorchUnpoolingLayer.hpp"

#include <variant>

namespace
{
    template <class... Ts>
    struct Overloaded : Ts...
    {
        using Ts::operator()...;
    };
    template <class... Ts>
    Overloaded(Ts...) -> Overloaded<Ts...>;
}

TorchLayerBuilder::TorchLayerBuilder() {}

std::shared_ptr<ILayer> TorchLayerBuilder::build(const LayersConfig &config)
{
    return std::visit(
        Overloaded{
            [](const Conv2DParams &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchConv2DLayer>(p);
            },
            [](const PoolingParams &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchPoolingLayer>(p);
            },
            [](const BatchNormParams &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchBatchNormLayer>(p);
            },
            [](const LinearParams &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchLinearLayer>(p);
            },
            [](const ActivationParams &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchActivationLayer>(p);
            },
            [](const IndexedPoolingParams &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchIndexPoolingLayer>(p);
            },
            [](const UnpoolingParams &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchUnpoolingLayer>(p);
            }},
        config.params);
}