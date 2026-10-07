// 層の型としての仕様(入力ポートと出力ポートの種類と数)を定義する。
#pragma once

#include "training/entities/domain-objects/ModelGraph/NodeSpec.hpp"
#include "PortKinds.hpp"

#include <string>
#include <cstddef>
#include <variant>
#include <vector>

struct OutputPortSpec
{
    std::string name;
    PortKind kind = PortKind::Feature;
};

struct InputPortSpec
{
    std::string name;
    PortKind kind = PortKind::Feature;
    bool variadic = false;    // trueなら同じポートに複数つなげる(concat / Add用)
    std::size_t minCount = 1; // 最低限必要な接続の本数
};

struct LayerPortSpec
{
    std::vector<InputPortSpec> inputPorts;
    std::vector<OutputPortSpec> outputPorts;
};

// 各層の入力・出力ポートの仕様を返す。

// Conv2Dは入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const Conv2DSpec &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}
// Poolingは入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const PoolingSpec &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}
// BatchNormは入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const BatchNormSpec &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}
// Linearは入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const LinearSpec &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// Poolingは入力1つ(x)と出力1つ(y)とインデックス(indices)
inline LayerPortSpec layerPortsOf(const IndexedPoolingSpec &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}, OutputPortSpec{"indices", PortKind::Indices}}};
}

// Unpoolingは入力1つ(x)とインデックス(indices)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const UnpoolingSpec &)
{
    return {
        {InputPortSpec{"x"}, InputPortSpec{"indices", PortKind::Indices}},
        {OutputPortSpec{"y"}}};
}

// Activationは入力1つ(x)と出力1つ(y)
// (NodeSpec に入っている型は ActivationSpec。ActivationSpec はその別名)
// 特徴マップにもトークン列にも使えるので、種類は Any(出力は入力と同じ種類になる)
inline LayerPortSpec layerPortsOf(const ActivationSpec &)
{
    return {
        {InputPortSpec{"x", PortKind::Any}},
        {OutputPortSpec{"y", PortKind::Any}}};
}

// ---- これから追加する層 ----
//
// *Spec の型はまだ定義していないので、名前だけを前方宣言している。
// 層を実装するときは、Layers/ に *Spec.hpp を作って NodeSpec.hpp から include し、
// NodeSpec(variant)に追加する。ここのポートの定義はそのまま使える。

struct AddSpec;
struct ConcatSpec;
struct UpsampleSpec;
struct ConvTranspose2DSpec;
struct AdaptiveAvgPoolSpec;
struct DropoutSpec;
struct FlattenSpec;
struct GroupNormSpec;

// Add(要素ごとの足し算。ResNet の残差接続、FPN)は入力2つ以上(x、可変長)と出力1つ(y)
// 入力はすべて同じ形状・同じ種類であること(Feature どうし、または Tokens どうし)。
inline LayerPortSpec layerPortsOf(const AddSpec &)
{
    return {
        {InputPortSpec{"x", PortKind::Any, /*variadic=*/true, /*minCount=*/2}},
        {OutputPortSpec{"y", PortKind::Any}}};
}

// Concat(チャンネル方向の結合。U-Net の skip connection)は入力2つ以上(x、可変長)と出力1つ(y)
// つないだ順にチャンネルが並ぶので、inputs の順番に意味がある。
// 入力はすべて同じ種類であること(Feature どうし、または Tokens どうし)。
inline LayerPortSpec layerPortsOf(const ConcatSpec &)
{
    return {
        {InputPortSpec{"x", PortKind::Any, /*variadic=*/true, /*minCount=*/2}},
        {OutputPortSpec{"y", PortKind::Any}}};
}

// Upsample(補間による拡大)は入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const UpsampleSpec &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// ConvTranspose2D(転置畳み込みによる拡大)は入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const ConvTranspose2DSpec &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// AdaptiveAvgPool(出力サイズを指定する平均プーリング。1x1 にすれば全体平均)は入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const AdaptiveAvgPoolSpec &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// Dropoutは入力1つ(x)と出力1つ(y)。種類は Any(特徴マップにもトークン列にも使える)
inline LayerPortSpec layerPortsOf(const DropoutSpec &)
{
    return {
        {InputPortSpec{"x", PortKind::Any}},
        {OutputPortSpec{"y", PortKind::Any}}};
}

// Flatten(Linear の前で (N, C, H, W) を (N, C*H*W) にする)は入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const FlattenSpec &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// GroupNormは入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const GroupNormSpec &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// ---- これから追加する層(Self-Attention / Transformer) ----
//
// これらの層は、特徴マップ (N, C, H, W) ではなく、トークン列 (N, L, D) を扱う
// (L = トークン数、D = 埋め込みの次元)。畳み込み系の層とつなぐときは、
// PatchEmbedding(特徴マップ → トークン列)と TokensToFeatureMap(トークン列 → 特徴マップ)で変換する。

struct PatchEmbeddingSpec;
struct TokensToFeatureMapSpec;
struct PositionalEncodingSpec;
struct LayerNormSpec;
struct SelfAttentionSpec;
struct MultiHeadAttentionSpec;
struct TransformerEncoderLayerSpec;
struct TransformerDecoderLayerSpec;

// PatchEmbedding(画像や特徴マップをパッチに分け、トークン列にする。ViT の入口)は入力1つ(x)と出力1つ(y)
// x: (N, C, H, W) → y: (N, L, D)
inline LayerPortSpec layerPortsOf(const PatchEmbeddingSpec &)
{
    return {
        {InputPortSpec{"x", PortKind::Feature}},
        {OutputPortSpec{"y", PortKind::Tokens}}};
}

// TokensToFeatureMap(トークン列を特徴マップに並べ直す。Transformer の後に Conv 系へ戻すとき)は入力1つ(x)と出力1つ(y)
// x: (N, L, D) → y: (N, D, H, W)
inline LayerPortSpec layerPortsOf(const TokensToFeatureMapSpec &)
{
    return {
        {InputPortSpec{"x", PortKind::Tokens}},
        {OutputPortSpec{"y", PortKind::Feature}}};
}

// PositionalEncoding(トークンの位置の情報を足す)は入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const PositionalEncodingSpec &)
{
    return {
        {InputPortSpec{"x", PortKind::Tokens}},
        {OutputPortSpec{"y", PortKind::Tokens}}};
}

// LayerNormは入力1つ(x)と出力1つ(y)。種類は Any(トークン列が主だが、特徴マップに使う構成もある)
inline LayerPortSpec layerPortsOf(const LayerNormSpec &)
{
    return {
        {InputPortSpec{"x", PortKind::Any}},
        {OutputPortSpec{"y", PortKind::Any}}};
}

// SelfAttention(同じトークン列どうしの注意。query = key = value)は入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const SelfAttentionSpec &)
{
    return {
        {InputPortSpec{"x", PortKind::Tokens}},
        {OutputPortSpec{"y", PortKind::Tokens}}};
}

// MultiHeadAttention(query と key / value を別に指定する注意。Cross-Attention 用)は
// 入力3つ(query, key, value)と出力1つ(y)
// 3 つに同じ出力をつなげば Self-Attention と同じになる。
inline LayerPortSpec layerPortsOf(const MultiHeadAttentionSpec &)
{
    return {
        {InputPortSpec{"query", PortKind::Tokens},
         InputPortSpec{"key", PortKind::Tokens},
         InputPortSpec{"value", PortKind::Tokens}},
        {OutputPortSpec{"y", PortKind::Tokens}}};
}

// TransformerEncoderLayer(Self-Attention + 全結合 + 残差接続 + 正規化 をまとめた 1 ブロック)は
// 入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const TransformerEncoderLayerSpec &)
{
    return {
        {InputPortSpec{"x", PortKind::Tokens}},
        {OutputPortSpec{"y", PortKind::Tokens}}};
}

// TransformerDecoderLayer(Self-Attention + encoder の出力への Cross-Attention + 全結合 をまとめた 1 ブロック)は
// 入力2つ(x, memory)と出力1つ(y)
// x: decoder 側のトークン列、memory: encoder の出力
inline LayerPortSpec layerPortsOf(const TransformerDecoderLayerSpec &)
{
    return {
        {InputPortSpec{"x", PortKind::Tokens}, InputPortSpec{"memory", PortKind::Tokens}},
        {OutputPortSpec{"y", PortKind::Tokens}}};
}

// ---- NodeSpec(variant)から引く入口 ----
//
// 入っている層の種類に合う layerPortsOf が呼ばれる。
// NodeSpec に型を足したのに上の定義を書き忘れると、ここでコンパイルエラーになる。
// 下の delete は、その「書き忘れ」をコンパイルエラーにするためのもの。これがないと、定義のない型が
// NodeSpec へ暗黙に変換されて、この関数自身を呼び続けてしまう。
template <class Spec>
LayerPortSpec layerPortsOf(const Spec &) = delete;

inline LayerPortSpec layerPortsOf(const NodeSpec &spec)
{
    return std::visit([](const auto &s)
                      { return layerPortsOf(s); },
                      spec);
}