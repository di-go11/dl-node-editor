#pragma once
// モデルグラフのプリセット(よく使う構成の組み立て方)。
// 現段階(2026/10/20)では、SegNet と U-Net の 2 種類のみをサポートする。

// entities
#include "training/entities/domain-objects/ModelGraph/DAG/GraphValidation.hpp"
#include "training/entities/domain-objects/ModelGraph/DAG/ModelGraphBuilder.hpp"

#include <string>

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
    // methods for building U-Net graph
    std::string appendEncoderBlock(ModelGraphBuilder &builder, int inChannels, int outChannels, double bnMomentum) const;

    void appendDecoderBlock(ModelGraphBuilder &builder, int upChannels, int skipChannels, int outChannels, double bnMomentum, const std::string &poolNodeId) const;
};