#include "training/infrastructure/torchFunc/TorchLayerBuilder.hpp"
#include "training/adapters/interfaces/ILayer.hpp"

// 各Specに対応する具象Layerのヘッダをinclude
#include "training/infrastructure/torchFunc/TorchConv2DLayer.hpp"
#include "training/infrastructure/torchFunc/TorchPoolingLayer.hpp"
#include "training/infrastructure/torchFunc/TorchBatchNormLayer.hpp"
#include "training/infrastructure/torchFunc/TorchLinearLayer.hpp"
#include "training/infrastructure/torchFunc/TorchActivationLayer.hpp"
#include "training/infrastructure/torchFunc/TorchIndexPoolingLayer.hpp"
#include "training/infrastructure/torchFunc/TorchUnpoolingLayer.hpp"

#include "training/entities/utils/Overloaded.hpp"

#include <variant>

TorchLayerBuilder::TorchLayerBuilder() {}

std::shared_ptr<ILayer> TorchLayerBuilder::build(const NodeSpec &config)
{
    return std::visit(
        Overloaded{
            [](const Conv2DSpec &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchConv2DLayer>(p);
            },
            [](const PoolingSpec &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchPoolingLayer>(p);
            },
            [](const BatchNormSpec &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchBatchNormLayer>(p);
            },
            [](const LinearSpec &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchLinearLayer>(p);
            },
            [](const ActivationSpec &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchActivationLayer>(p);
            },
            [](const IndexedPoolingSpec &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchIndexPoolingLayer>(p);
            },
            [](const UnpoolingSpec &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchUnpoolingLayer>(p);
            }},
        config);
}