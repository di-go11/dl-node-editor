#pragma once

#include "training/entities/domain-objects/ModelGraph/NodeSpec.hpp"
#include "training/entities/domain-objects/ModelGraph/PortShape.hpp"

#include <cstdint>
#include <string>
#include <utility>
#include <variant>
#include <vector>

// 各層の形状規則。「この層に、この形状が入ったら、何が出るか」を返す。
//
// inputs は、その層の入力ポート(nodePortsOf の inputPorts)と同じ順に並べた形状。
// 可変長ポートは使わない層だけを対象にしている(Add / Concat は層を実装するときに足す)。
// 入力の本数が合っていることは、ポートの検証(GraphValidation)が先に保証する。
// outputs は、nodePortsOf の outputPorts と同じ順に並べて返す。
//
// グラフ全体をたどる処理(GraphShapeInference)は、この規則を std::visit で引くだけにする。
// 層を足すときは、ここに規則を足すだけで済む。

struct ShapeResult
{
    std::vector<PortShape> outputs;
    std::string error; // 空なら成功。入力が規則に合わないときは、その理由を書く

    bool ok() const { return error.empty(); }

    static ShapeResult success(std::vector<PortShape> outputs)
    {
        return ShapeResult{std::move(outputs), {}};
    }
    static ShapeResult failure(std::string message)
    {
        return ShapeResult{{}, std::move(message)};
    }
};

namespace shape_rules_detail
{
    // 畳み込み・プーリングの出力サイズ: floor((in + 2p - d(k-1) - 1) / s) + 1
    //
    // 分子が負のときは C++ の整数除算が 0 に向かって切り捨てるため、floor にならない
    // (例: -1 / 2 = 0 になり、本来は無効なのに出力サイズ 1 になってしまう)。
    // そのため、分子が負のときは先に「出力サイズが 1 未満」として扱う。
    inline bool slidingWindowOutSize(int64_t in, int64_t kernel, int64_t stride,
                                     int64_t padding, int64_t dilation, int64_t &out)
    {
        if (stride < 1)
        {
            return false;
        }
        const int64_t span = in + 2 * padding - dilation * (kernel - 1) - 1;
        if (span < 0)
        {
            return false;
        }
        out = span / stride + 1;
        return true;
    }

    // Pooling / IndexedPooling 共通。チャンネル数は変わらない。
    inline bool pooledShape(const FeatureMapShape &in, int64_t kernel, int64_t stride,
                            int64_t padding, FeatureMapShape &out)
    {
        out.channels = in.channels;
        return slidingWindowOutSize(in.height, kernel, stride, padding, 1, out.height) &&
               slidingWindowOutSize(in.width, kernel, stride, padding, 1, out.width);
    }

    inline ShapeResult notFeatureMap(const std::string &layerName, const PortShape &actual)
    {
        return ShapeResult::failure(layerName + " の入力は特徴マップである必要があります(実際: " +
                                    toString(actual) + ")");
    }

    inline ShapeResult emptyOutput(const std::string &layerName, const FeatureMapShape &in)
    {
        return ShapeResult::failure(layerName + " の出力サイズが 1 未満になります(入力: " + toString(in) + ")");
    }
}

// Conv2D: in_channels == C。出力は (out_channels, 出力 H, 出力 W)。
inline ShapeResult inferOutputShapes(const Conv2DSpec &p, const std::vector<PortShape> &inputs)
{
    const auto *in = std::get_if<FeatureMapShape>(&inputs.at(0));
    if (!in)
    {
        return shape_rules_detail::notFeatureMap("Conv2D", inputs.at(0));
    }
    if (in->channels != p.inChannels)
    {
        return ShapeResult::failure("Conv2D の in_channels(" + std::to_string(p.inChannels) +
                                    ")が、入力のチャンネル数(" + std::to_string(in->channels) + ")と一致しません");
    }

    FeatureMapShape out;
    out.channels = p.outChannels;
    if (!shape_rules_detail::slidingWindowOutSize(in->height, p.kernelSize, p.stride, p.padding, p.dilation, out.height) ||
        !shape_rules_detail::slidingWindowOutSize(in->width, p.kernelSize, p.stride, p.padding, p.dilation, out.width))
    {
        return shape_rules_detail::emptyOutput("Conv2D", *in);
    }
    return ShapeResult::success({PortShape{out}});
}

// Pooling: チャンネル数は変わらず、H と W が縮む。
inline ShapeResult inferOutputShapes(const PoolingSpec &p, const std::vector<PortShape> &inputs)
{
    const auto *in = std::get_if<FeatureMapShape>(&inputs.at(0));
    if (!in)
    {
        return shape_rules_detail::notFeatureMap("Pooling", inputs.at(0));
    }

    FeatureMapShape out;
    if (!shape_rules_detail::pooledShape(*in, p.kernelSize, p.stride, p.padding, out))
    {
        return shape_rules_detail::emptyOutput("Pooling", *in);
    }
    return ShapeResult::success({PortShape{out}});
}

// IndexedPooling: 出力 y と indices は、どちらも縮んだ後の形状。
inline ShapeResult inferOutputShapes(const IndexedPoolingSpec &p, const std::vector<PortShape> &inputs)
{
    const auto *in = std::get_if<FeatureMapShape>(&inputs.at(0));
    if (!in)
    {
        return shape_rules_detail::notFeatureMap("IndexedPooling", inputs.at(0));
    }

    FeatureMapShape out;
    if (!shape_rules_detail::pooledShape(*in, p.kernelSize, p.stride, p.padding, out))
    {
        return shape_rules_detail::emptyOutput("IndexedPooling", *in);
    }
    return ShapeResult::success({PortShape{out}, PortShape{out}}); // y, indices
}

// Unpooling: x と indices の形状が一致すること。出力 H, W は (in - 1) * stride - 2 * padding + kernel。
inline ShapeResult inferOutputShapes(const UnpoolingSpec &p, const std::vector<PortShape> &inputs)
{
    const auto *x = std::get_if<FeatureMapShape>(&inputs.at(0));
    if (!x)
    {
        return shape_rules_detail::notFeatureMap("Unpooling", inputs.at(0));
    }
    const auto *indices = std::get_if<FeatureMapShape>(&inputs.at(1));
    if (!indices)
    {
        return shape_rules_detail::notFeatureMap("Unpooling(indices)", inputs.at(1));
    }
    if (!(*x == *indices))
    {
        return ShapeResult::failure("Unpooling の x(" + toString(*x) + ")と indices(" + toString(*indices) +
                                    ")の形状が一致しません");
    }

    FeatureMapShape out;
    out.channels = x->channels;
    out.height = (x->height - 1) * p.stride - 2 * p.padding + p.kernelSize;
    out.width = (x->width - 1) * p.stride - 2 * p.padding + p.kernelSize;
    if (out.height < 1 || out.width < 1)
    {
        return shape_rules_detail::emptyOutput("Unpooling", *x);
    }
    return ShapeResult::success({PortShape{out}});
}

// BatchNorm: num_features == C。形状は変わらない。
inline ShapeResult inferOutputShapes(const BatchNormSpec &p, const std::vector<PortShape> &inputs)
{
    const auto *in = std::get_if<FeatureMapShape>(&inputs.at(0));
    if (!in)
    {
        return shape_rules_detail::notFeatureMap("BatchNorm", inputs.at(0));
    }
    if (in->channels != p.numFeatures)
    {
        return ShapeResult::failure("BatchNorm の num_features(" + std::to_string(p.numFeatures) +
                                    ")が、入力のチャンネル数(" + std::to_string(in->channels) + ")と一致しません");
    }
    return ShapeResult::success({inputs.at(0)});
}

// Linear: 入力の最後の次元(特徴マップなら W、トークン列なら D)に作用する(PyTorch と同じ)。
// 最後の次元 == in_features で、出力ではその次元が out_features になる。
inline ShapeResult inferOutputShapes(const LinearSpec &p, const std::vector<PortShape> &inputs)
{
    if (const auto *map = std::get_if<FeatureMapShape>(&inputs.at(0)))
    {
        if (map->width != p.inFeatures)
        {
            return ShapeResult::failure("Linear の in_features(" + std::to_string(p.inFeatures) +
                                        ")が、入力の最後の次元 W(" + std::to_string(map->width) + ")と一致しません");
        }
        FeatureMapShape out = *map;
        out.width = p.outFeatures;
        return ShapeResult::success({PortShape{out}});
    }

    const auto &tokens = std::get<TokenSequenceShape>(inputs.at(0));
    if (tokens.embeddingDim != p.inFeatures)
    {
        return ShapeResult::failure("Linear の in_features(" + std::to_string(p.inFeatures) +
                                    ")が、入力の最後の次元 D(" + std::to_string(tokens.embeddingDim) + ")と一致しません");
    }
    TokenSequenceShape out = tokens;
    out.embeddingDim = p.outFeatures;
    return ShapeResult::success({PortShape{out}});
}

// Activation: 形状は変わらない(種類は Any なので、入力の種類を引き継ぐ)。
inline ShapeResult inferOutputShapes(const ActivationSpec &, const std::vector<PortShape> &inputs)
{
    return ShapeResult::success({inputs.at(0)});
}

// ---- NodeSpec(variant)から引く入口 ----
//
// 入っている層の種類に合う inferOutputShapes が呼ばれる。
// NodeSpec に型を足したのに上の規則を書き忘れると、ここでコンパイルエラーになる。
// 下の delete は、その「書き忘れ」をコンパイルエラーにするためのもの。これがないと、規則のない型が
// NodeSpec へ暗黙に変換されて、この関数自身を呼び続けてしまう。
template <class Spec>
ShapeResult inferOutputShapes(const Spec &, const std::vector<PortShape> &) = delete;

inline ShapeResult inferOutputShapes(const NodeSpec &spec, const std::vector<PortShape> &inputs)
{
    return std::visit([&inputs](const auto &s)
                      { return inferOutputShapes(s, inputs); },
                      spec);
}
