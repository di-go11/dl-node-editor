#pragma once
// モデルグラフのプリセットを定義するUsecase。
// 現段階(2026/10/20)では、miniサイズのSegNetとU-Netの2種類のみをサポートする。

// entities
#include "training/entities/domain-objects/ModelGraph/ModelGraph.hpp"
#include "training/entities/domain-objects/ModelGraph/DAG/GraphValidation.hpp"
#include "training/entities/domain-objects/ModelGraph/DAG/ModelGraphBuilder.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/Conv2DSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/ActivationSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/BatchNormSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/IndexedPoolingSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/UnpoolingSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/UpsampleSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/AddSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/ConcatSpec.hpp"

#include <exception>
#include <filesystem>
#include <memory>
#include <stdexcept>
#include <string>
#include <variant>

class IModelGraphPreset
{
public:
    virtual ~IModelGraphPreset() = default;
    virtual ValidatedModelGraph buildGraph(const int numClasses) const = 0;
};

class SegnetModelSample : public IModelGraphPreset
{
public:
    ValidatedModelGraph buildGraph(const int numClasses) const override;

private:
    // methods for building SegNet graph
    std::string appendEncoderBlock(ModelGraphBuilder &builder, int inChannels, int outChannels, double bnMomentum) const;

    void appendDecoderBlock(ModelGraphBuilder &builder, int inChannels, int outChannels, double bnMomentum, const std::string &poolNodeId) const;
};

class UnetModelSample : public IModelGraphPreset
{
public:
    ValidatedModelGraph buildGraph(const int numClasses) const override;

private:
    // methods for building SegNet graph
    std::string appendEncoderBlock(ModelGraphBuilder &builder, int inChannels, int outChannels, double bnMomentum) const;

    void appendDecoderBlock(ModelGraphBuilder &builder, int upChannels, int skipChannels, int outChannels, double bnMomentum, const std::string &poolNodeId) const;
};