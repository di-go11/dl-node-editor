#pragma once

#include "training/entities/domain-objects/ModelGraph/NodeSpec.hpp"

#include <cstdint>
#include <stdexcept>
#include <string>
#include <type_traits>

// 層パラメータ(*Spec)のフィールド定義を集約する唯一の場所。
//
// 以前は ModelGraphFingerprint(ハッシュ計算)と ModelGraphArchive(読み書き)が
// それぞれ独立に全フィールドを列挙していたため、層のパラメータを 1 つ増やすと
// 3 か所(ハッシュ・書き出し・読み込み)を直す必要があり、片方の更新漏れが起きやすかった。
// ここで一度だけ列挙し、3 者すべてがこの訪問関数を起点にする。
//
// libtorch には依存しない(entities 層)。infrastructure 側は
// 受け取った値を archive の型に載せ替えるだけでよい。

// 層種のタグ。
// 数値は archive に、文字列は fingerprint に永続化されるため、
// 既存の値・綴りは変更しないこと(過去の .pt が読めなくなる)。追加は末尾に。
enum class LayerKind : std::int64_t
{
    Conv2D = 0,
    Pooling = 1,
    BatchNorm = 2,
    Linear = 3,
    Activation = 4,
    IndexedPooling = 5,
    Unpooling = 6
};

inline LayerKind layerKindOf(const Conv2DSpec &) { return LayerKind::Conv2D; }
inline LayerKind layerKindOf(const PoolingSpec &) { return LayerKind::Pooling; }
inline LayerKind layerKindOf(const BatchNormSpec &) { return LayerKind::BatchNorm; }
inline LayerKind layerKindOf(const LinearSpec &) { return LayerKind::Linear; }
inline LayerKind layerKindOf(const ActivationSpec &) { return LayerKind::Activation; }
inline LayerKind layerKindOf(const IndexedPoolingSpec &) { return LayerKind::IndexedPooling; }
inline LayerKind layerKindOf(const UnpoolingSpec &) { return LayerKind::Unpooling; }

// fingerprint の正規化文字列に使う層種名。
inline std::string layerKindTag(LayerKind kind)
{
    switch (kind)
    {
    case LayerKind::Conv2D:
        return "conv2d";
    case LayerKind::Pooling:
        return "pool";
    case LayerKind::BatchNorm:
        return "batchnorm";
    case LayerKind::Linear:
        return "linear";
    case LayerKind::Activation:
        return "activation";
    case LayerKind::IndexedPooling:
        return "indexed";
    case LayerKind::Unpooling:
        return "unpool";
    }

    throw std::runtime_error("layerKindTag: 未知の LayerKind (" +
                             std::to_string(static_cast<std::int64_t>(kind)) + ")");
}

// *Spec の各フィールドを (archive のキー名, メンバ参照) の順に訪問する。
//
// Spec が const なら読み取り用、非 const なら「訪問しながら代入する」
// 読み込み用として使える(archive からの復元がこれを使う)。
//
// フィールドの並び順は fingerprint の文字列にも反映されるため、
// 既存フィールドの順序は変更しないこと。追加は各ブロックの末尾に。
template <class Spec, class F>
void visitLayerFields(Spec &p, F &&f)
{
    using T = std::remove_const_t<Spec>;

    if constexpr (std::is_same_v<T, Conv2DSpec>)
    {
        f("in_channels", p.inChannels);
        f("out_channels", p.outChannels);
        f("kernel_size", p.kernelSize);
        f("stride", p.stride);
        f("padding", p.padding);
        f("dilation", p.dilation);
    }
    else if constexpr (std::is_same_v<T, PoolingSpec>)
    {
        f("pooling_type", p.type);
        f("kernel_size", p.kernelSize);
        f("stride", p.stride);
        f("padding", p.padding);
    }
    else if constexpr (std::is_same_v<T, BatchNormSpec>)
    {
        f("num_features", p.numFeatures);
        f("eps", p.eps);
        f("momentum", p.momentum);
    }
    else if constexpr (std::is_same_v<T, LinearSpec>)
    {
        f("in_features", p.inFeatures);
        f("out_features", p.outFeatures);
        f("bias", p.bias);
    }
    else if constexpr (std::is_same_v<T, ActivationSpec>)
    {
        f("activation_type", p.activationType);
        f("dim", p.dim);
    }
    else if constexpr (std::is_same_v<T, IndexedPoolingSpec>)
    {
        f("kernel_size", p.kernelSize);
        f("stride", p.stride);
        f("padding", p.padding);
    }
    else if constexpr (std::is_same_v<T, UnpoolingSpec>)
    {
        f("kernel_size", p.kernelSize);
        f("stride", p.stride);
        f("padding", p.padding);
    }
    else
    {
        static_assert(sizeof(T) == 0, "未対応の NodeSpec 型です");
    }
}
