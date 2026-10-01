#pragma once

#include "LayersConfig.hpp"
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
inline LayerPortSpec layerPortsOf(const Conv2DParams &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}
// Poolingは入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const PoolingParams &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}
// BatchNormは入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const BatchNormParams &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}
// Linearは入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const LinearParams &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// Poolingは入力1つ(x)と出力1つ(y)とインデックス(indices)
inline LayerPortSpec layerPortsOf(const IndexedPoolingParams &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}, OutputPortSpec{"indices", PortKind::Indices}}};
}

// Unpoolingは入力1つ(x)とインデックス(indices)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const UnpoolingParams &)
{
    return {
        {InputPortSpec{"x"}, InputPortSpec{"indices"}},
        {OutputPortSpec{"y"}}};
}

// Activationは入力1つ(x)と出力1つ(y)
// (LayersParams に入っている型は ActivationConfig。ActivationParams はその別名)
inline LayerPortSpec layerPortsOf(const ActivationConfig &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// ---- これから追加する層 ----
//
// *Params の型はまだ定義していないので、名前だけを前方宣言している。
// 層を実装するときは、Layers/ に *Params.hpp を作って LayersParams.hpp から include し、
// LayersParams(variant)に追加する。ここのポートの定義はそのまま使える。

struct AddParams;
struct ConcatParams;
struct UpsampleParams;
struct ConvTranspose2DParams;
struct AdaptiveAvgPoolParams;
struct DropoutParams;
struct FlattenParams;
struct GroupNormParams;

// Add(要素ごとの足し算。ResNet の残差接続、FPN)は入力2つ以上(x、可変長)と出力1つ(y)
// 入力はすべて同じ形状であること。
inline LayerPortSpec layerPortsOf(const AddParams &)
{
    return {
        {InputPortSpec{"x", /*variadic=*/true, /*minCount=*/2}},
        {OutputPortSpec{"y"}}};
}

// Concat(チャンネル方向の結合。U-Net の skip connection)は入力2つ以上(x、可変長)と出力1つ(y)
// つないだ順にチャンネルが並ぶので、inputs の順番に意味がある。
inline LayerPortSpec layerPortsOf(const ConcatParams &)
{
    return {
        {InputPortSpec{"x", /*variadic=*/true, /*minCount=*/2}},
        {OutputPortSpec{"y"}}};
}

// Upsample(補間による拡大)は入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const UpsampleParams &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// ConvTranspose2D(転置畳み込みによる拡大)は入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const ConvTranspose2DParams &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// AdaptiveAvgPool(出力サイズを指定する平均プーリング。1x1 にすれば全体平均)は入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const AdaptiveAvgPoolParams &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// Dropoutは入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const DropoutParams &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// Flatten(Linear の前で (N, C, H, W) を (N, C*H*W) にする)は入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const FlattenParams &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// GroupNormは入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const GroupNormParams &)
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

struct PatchEmbeddingParams;
struct TokensToFeatureMapParams;
struct PositionalEncodingParams;
struct LayerNormParams;
struct SelfAttentionParams;
struct MultiHeadAttentionParams;
struct TransformerEncoderLayerParams;
struct TransformerDecoderLayerParams;

// PatchEmbedding(画像や特徴マップをパッチに分け、トークン列にする。ViT の入口)は入力1つ(x)と出力1つ(y)
// x: (N, C, H, W) → y: (N, L, D)
inline LayerPortSpec layerPortsOf(const PatchEmbeddingParams &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// TokensToFeatureMap(トークン列を特徴マップに並べ直す。Transformer の後に Conv 系へ戻すとき)は入力1つ(x)と出力1つ(y)
// x: (N, L, D) → y: (N, D, H, W)
inline LayerPortSpec layerPortsOf(const TokensToFeatureMapParams &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// PositionalEncoding(トークンの位置の情報を足す)は入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const PositionalEncodingParams &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// LayerNormは入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const LayerNormParams &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// SelfAttention(同じトークン列どうしの注意。query = key = value)は入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const SelfAttentionParams &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// MultiHeadAttention(query と key / value を別に指定する注意。Cross-Attention 用)は
// 入力3つ(query, key, value)と出力1つ(y)
// 3 つに同じ出力をつなげば Self-Attention と同じになる。
inline LayerPortSpec layerPortsOf(const MultiHeadAttentionParams &)
{
    return {
        {InputPortSpec{"query"}, InputPortSpec{"key"}, InputPortSpec{"value"}},
        {OutputPortSpec{"y"}}};
}

// TransformerEncoderLayer(Self-Attention + 全結合 + 残差接続 + 正規化 をまとめた 1 ブロック)は
// 入力1つ(x)と出力1つ(y)
inline LayerPortSpec layerPortsOf(const TransformerEncoderLayerParams &)
{
    return {
        {InputPortSpec{"x"}},
        {OutputPortSpec{"y"}}};
}

// TransformerDecoderLayer(Self-Attention + encoder の出力への Cross-Attention + 全結合 をまとめた 1 ブロック)は
// 入力2つ(x, memory)と出力1つ(y)
// x: decoder 側のトークン列、memory: encoder の出力
inline LayerPortSpec layerPortsOf(const TransformerDecoderLayerParams &)
{
    return {
        {InputPortSpec{"x"}, InputPortSpec{"memory"}},
        {OutputPortSpec{"y"}}};
}

// ---- LayersConfig(variant)から引く入口 ----
//
// 入っている層の種類に合う layerPortsOf が呼ばれる。
// LayersParams に型を足したのに上の定義を書き忘れると、ここでコンパイルエラーになる。
inline LayerPortSpec layerPortsOf(const LayersConfig &layer)
{
    return std::visit([](const auto &params)
                      { return layerPortsOf(params); },
                      layer.params);
}