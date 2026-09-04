#include "training/infrastructure/torchModel/ModelGraphArchive.hpp"

#include <torch/torch.h>

#include <cstdint>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <variant>

namespace
{
// LayersParams の alternative が増減したらここで気付けるようにする。
// 増やした場合は LayersParamsFields.hpp(LayerKind・フィールド列挙)の更新と、
// 下の readLayer の分岐追加、kModelGraphArchiveVersion のインクリメントが必要。
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
        [&w](const auto &p)
        {
            w.i64("kind", static_cast<int64_t>(layerKindOf(p)));

            // フィールドの列挙は entities 側(visitLayerFields)に任せ、
            // ここは値の型ごとの載せ替えだけを行う。
            visitLayerFields(p,
                             [&w](const char *name, const auto &value)
                             {
                                 using V = std::decay_t<decltype(value)>;
                                 if constexpr (std::is_same_v<V, double>)
                                 {
                                     w.f64(name, value);
                                 }
                                 else if constexpr (std::is_same_v<V, bool>)
                                 {
                                     w.i64(name, value ? 1 : 0);
                                 }
                                 else if constexpr (std::is_enum_v<V>)
                                 {
                                     w.i64(name, static_cast<int64_t>(value));
                                 }
                                 else
                                 {
                                     w.i64(name, static_cast<int64_t>(value));
                                 }
                             });
        },
        layer.params);
}

// 同じフィールド列挙を「代入する側」から使う。
// visitLayerFields に非 const の Params を渡すとメンバへの可変参照が来るため、
// そこへ archive から読んだ値を書き込む。
template <class Params>
Params readParams(const Reader &r)
{
    Params p;
    visitLayerFields(p,
                     [&r](const char *name, auto &value)
                     {
                         using V = std::decay_t<decltype(value)>;
                         if constexpr (std::is_same_v<V, double>)
                         {
                             value = r.f64(name);
                         }
                         else if constexpr (std::is_same_v<V, bool>)
                         {
                             value = (r.i64(name) != 0);
                         }
                         else
                         {
                             // 整数・enum とも int64 から復元する
                             value = static_cast<V>(r.i64(name));
                         }
                     });
    return p;
}

LayersConfig readLayer(torch::serialize::InputArchive &in, std::size_t index)
{
    const Reader r{in, layerPrefix(index)};
    const auto kind = static_cast<LayerKind>(r.i64("kind"));

    switch (kind)
    {
    case LayerKind::Conv2D:
        return LayersConfig{readParams<Conv2DParams>(r)};
    case LayerKind::Pooling:
        return LayersConfig{readParams<PoolingParams>(r)};
    case LayerKind::BatchNorm:
        return LayersConfig{readParams<BatchNormParams>(r)};
    case LayerKind::Linear:
        return LayersConfig{readParams<LinearParams>(r)};
    case LayerKind::Activation:
        return LayersConfig{readParams<ActivationConfig>(r)};
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
