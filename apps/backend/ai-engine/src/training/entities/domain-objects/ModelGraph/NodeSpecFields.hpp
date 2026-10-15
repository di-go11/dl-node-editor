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
enum class NodeKind : std::int64_t
{
    Conv2D = 0,
    Pooling = 1,
    BatchNorm = 2,
    Linear = 3,
    Activation = 4,
    IndexedPooling = 5,
    Unpooling = 6,
    Upsample = 7,
    Add = 8
};

inline NodeKind nodeKindOf(const Conv2DSpec &) { return NodeKind::Conv2D; }
inline NodeKind nodeKindOf(const PoolingSpec &) { return NodeKind::Pooling; }
inline NodeKind nodeKindOf(const BatchNormSpec &) { return NodeKind::BatchNorm; }
inline NodeKind nodeKindOf(const LinearSpec &) { return NodeKind::Linear; }
inline NodeKind nodeKindOf(const ActivationSpec &) { return NodeKind::Activation; }
inline NodeKind nodeKindOf(const IndexedPoolingSpec &) { return NodeKind::IndexedPooling; }
inline NodeKind nodeKindOf(const UnpoolingSpec &) { return NodeKind::Unpooling; }
inline NodeKind nodeKindOf(const UpsampleSpec &) { return NodeKind::Upsample; }
inline NodeKind nodeKindOf(const AddSpec &) { return NodeKind::Add; }

// fingerprint の正規化文字列に使う層種名。
inline std::string nodeKindTag(NodeKind kind)
{
    switch (kind)
    {
    case NodeKind::Conv2D:
        return "conv2d";
    case NodeKind::Pooling:
        return "pool";
    case NodeKind::BatchNorm:
        return "batchnorm";
    case NodeKind::Linear:
        return "linear";
    case NodeKind::Activation:
        return "activation";
    case NodeKind::IndexedPooling:
        return "indexed";
    case NodeKind::Unpooling:
        return "unpool";
    case NodeKind::Upsample:
        return "upsample";
    case NodeKind::Add:
        return "add";
    }

    throw std::runtime_error("nodeKindTag: 未知の NodeKind (" +
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
void visitSpecFields(Spec &p, F &&f)
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
    else if constexpr (std::is_same_v<T, UpsampleSpec>)
    {
        f("scale_factor", p.scaleFactor);
        f("mode", p.upsampleMode);
    }
    else if constexpr (std::is_same_v<T, AddSpec>)
    {
        f("alpha", p.alpha);
    }
    else
    {
        static_assert(sizeof(T) == 0, "未対応の NodeSpec 型です");
    }
}
