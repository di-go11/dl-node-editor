#include "training/infrastructure/torchModel/ModelGraphArchive.hpp"

#include "training/entities/domain-objects/ActivationConfig.hpp"
#include "training/entities/domain-objects/ActivationType.hpp"
#include "training/entities/domain-objects/LayersConfig.hpp"
#include "training/entities/domain-objects/PoolingType.hpp"

#include <torch/torch.h>

#include <cstdint>
#include <stdexcept>
#include <string>
#include <variant>

namespace
{
// LayersParams の alternative が増減したらここで気付けるようにする。
// 増やした場合は LayerKind への追加、write/read の分岐追加、
// kModelGraphArchiveVersion のインクリメントが必要。
static_assert(std::variant_size_v<LayersParams> == 5,
              "LayersParams の要素数が変わりました。ModelGraphArchive の対応を更新してください。");

// archive への読み書きヘルパ。スカラーは 1 要素テンソルとして保存する
// (既存の TorchCheckpointStore / TorchModel と同じ表現)。
struct Writer
{
    torch::serialize::OutputArchive &out;
    const std::string prefix;

    void i64(const std::string &key, int64_t value) const
    {
        out.write(prefix + key, torch::tensor(value));
    }
    void f64(const std::string &key, double value) const
    {
        out.write(prefix + key, torch::tensor(value, torch::kFloat64));
    }
};

struct Reader
{
    torch::serialize::InputArchive &in;
    const std::string prefix;

    int64_t i64(const std::string &key) const
    {
        at::Tensor t;
        in.read(prefix + key, t);
        return t.item<int64_t>();
    }
    double f64(const std::string &key) const
    {
        at::Tensor t;
        in.read(prefix + key, t);
        return t.item<double>();
    }
};

std::string layerPrefix(std::size_t index)
{
    return "layer_" + std::to_string(index) + "_";
}

void writeLayer(torch::serialize::OutputArchive &out, std::size_t index, const LayersConfig &layer)
{
    const Writer w{out, layerPrefix(index)};

    std::visit(
        [&](const auto &p)
        {
            using T = std::decay_t<decltype(p)>;

            if constexpr (std::is_same_v<T, Conv2DParams>)
            {
                w.i64("kind", static_cast<int64_t>(LayerKind::Conv2D));
                w.i64("in_channels", p.inChannels);
                w.i64("out_channels", p.outChannels);
                w.i64("kernel_size", p.kernelSize);
                w.i64("stride", p.stride);
                w.i64("padding", p.padding);
            }
            else if constexpr (std::is_same_v<T, PoolingParams>)
            {
                w.i64("kind", static_cast<int64_t>(LayerKind::Pooling));
                w.i64("pooling_type", static_cast<int64_t>(p.type));
                w.i64("kernel_size", p.kernelSize);
                w.i64("stride", p.stride);
                w.i64("padding", p.padding);
            }
            else if constexpr (std::is_same_v<T, BatchNormParams>)
            {
                w.i64("kind", static_cast<int64_t>(LayerKind::BatchNorm));
                w.i64("num_features", p.numFeatures);
                w.f64("eps", p.eps);
                w.f64("momentum", p.momentum);
            }
            else if constexpr (std::is_same_v<T, LinearParams>)
            {
                w.i64("kind", static_cast<int64_t>(LayerKind::Linear));
                w.i64("in_features", p.inFeatures);
                w.i64("out_features", p.outFeatures);
                w.i64("bias", p.bias ? 1 : 0);
            }
            else if constexpr (std::is_same_v<T, ActivationParams>)
            {
                w.i64("kind", static_cast<int64_t>(LayerKind::Activation));
                w.i64("activation_type", static_cast<int64_t>(p.activationType));
                w.i64("dim", p.dim);
            }
            else
            {
                static_assert(sizeof(T) == 0, "未対応の LayersParams 型です");
            }
        },
        layer.params);
}

LayersConfig readLayer(torch::serialize::InputArchive &in, std::size_t index)
{
    const Reader r{in, layerPrefix(index)};
    const auto kind = static_cast<LayerKind>(r.i64("kind"));

    switch (kind)
    {
    case LayerKind::Conv2D:
    {
        Conv2DParams p;
        p.inChannels = r.i64("in_channels");
        p.outChannels = r.i64("out_channels");
        p.kernelSize = r.i64("kernel_size");
        p.stride = r.i64("stride");
        p.padding = r.i64("padding");
        return LayersConfig{p};
    }
    case LayerKind::Pooling:
    {
        PoolingParams p;
        p.type = static_cast<PoolingType>(r.i64("pooling_type"));
        p.kernelSize = r.i64("kernel_size");
        p.stride = r.i64("stride");
        p.padding = r.i64("padding");
        return LayersConfig{p};
    }
    case LayerKind::BatchNorm:
    {
        BatchNormParams p;
        p.numFeatures = r.i64("num_features");
        p.eps = r.f64("eps");
        p.momentum = r.f64("momentum");
        return LayersConfig{p};
    }
    case LayerKind::Linear:
    {
        LinearParams p;
        p.inFeatures = r.i64("in_features");
        p.outFeatures = r.i64("out_features");
        p.bias = r.i64("bias") != 0;
        return LayersConfig{p};
    }
    case LayerKind::Activation:
    {
        ActivationConfig p;
        p.activationType = static_cast<ActivationType>(r.i64("activation_type"));
        p.dim = static_cast<int>(r.i64("dim"));
        return LayersConfig{p};
    }
    }

    throw std::runtime_error(
        "readModelGraph: 未知の LayerKind (" +
        std::to_string(static_cast<int64_t>(kind)) + ") layer_" + std::to_string(index));
}
} // namespace

void writeModelGraph(torch::serialize::OutputArchive &archive, const ModelGraph &graph)
{
    archive.write("format_version", torch::tensor(kModelGraphArchiveVersion));
    archive.write("layer_count", torch::tensor(static_cast<int64_t>(graph.layers.size())));

    for (std::size_t i = 0; i < graph.layers.size(); ++i)
    {
        writeLayer(archive, i, graph.layers[i]);
    }
}

ModelGraph readModelGraph(torch::serialize::InputArchive &archive)
{
    at::Tensor versionTensor;
    archive.read("format_version", versionTensor);
    const int64_t version = versionTensor.item<int64_t>();
    if (version != kModelGraphArchiveVersion)
    {
        throw std::runtime_error(
            "readModelGraph: 非対応のフォーマットバージョンです (archive=" +
            std::to_string(version) + ", expected=" +
            std::to_string(kModelGraphArchiveVersion) + ")");
    }

    at::Tensor countTensor;
    archive.read("layer_count", countTensor);
    const auto count = static_cast<std::size_t>(countTensor.item<int64_t>());

    ModelGraph graph;
    graph.layers.reserve(count);
    for (std::size_t i = 0; i < count; ++i)
    {
        graph.layers.push_back(readLayer(archive, i));
    }
    return graph;
}
