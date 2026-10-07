#include "training/infrastructure/torchModel/ModelGraphArchive.hpp"

#include <torch/torch.h>

#include <cstdint>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <variant>

namespace
{
// NodeSpec の alternative が増減したらここで気付けるようにする。
// 増やした場合は NodeSpecFields.hpp(NodeKind・フィールド列挙)の更新と、
// 下の readLayer の分岐追加、kModelGraphArchiveVersion のインクリメントが必要。
static_assert(std::variant_size_v<NodeSpec> == 7,
              "NodeSpec の要素数が変わりました。ModelGraphArchive の対応を更新してください。");

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
    void str(const std::string &key, const std::string &value) const
    {
        out.write(prefix + key, c10::IValue(value));
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
    std::string str(const std::string &key) const
    {
        c10::IValue value;
        in.read(prefix + key, value);
        return value.toStringRef();
    }
};

std::string nodePrefix(std::size_t index)
{
    return "node_" + std::to_string(index) + "_";
}

// 出力ポート 1 つへの参照を、ノード ID とポート名の 2 つの文字列として書く / 読む。
// (グラフ入力を指すときは、どちらも空文字になる)
void writePortRef(const Writer &w, const std::string &key, const PortRef &ref)
{
    w.str(key + "node", ref.nodeId);
    w.str(key + "port", ref.port);
}

PortRef readPortRef(const Reader &r, const std::string &key)
{
    return PortRef{r.str(key + "node"), r.str(key + "port")};
}

void writeLayer(torch::serialize::OutputArchive &out, std::size_t index, const NodeSpec &layer)
{
    const Writer w{out, nodePrefix(index)};

    std::visit(
        [&w](const auto &p)
        {
            w.i64("kind", static_cast<int64_t>(nodeKindOf(p)));

            // フィールドの列挙は entities 側(visitSpecFields)に任せ、
            // ここは値の型ごとの載せ替えだけを行う。
            visitSpecFields(p,
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
        layer);
}

// 同じフィールド列挙を「代入する側」から使う。
// visitSpecFields に非 const の Spec を渡すとメンバへの可変参照が来るため、
// そこへ archive から読んだ値を書き込む。
template <class Spec>
Spec readSpec(const Reader &r)
{
    Spec p;
    visitSpecFields(p,
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

NodeSpec readLayer(torch::serialize::InputArchive &in, std::size_t index)
{
    const Reader r{in, nodePrefix(index)};
    const auto kind = static_cast<NodeKind>(r.i64("kind"));

    switch (kind)
    {
    case NodeKind::Conv2D:
        return NodeSpec{readSpec<Conv2DSpec>(r)};
    case NodeKind::Pooling:
        return NodeSpec{readSpec<PoolingSpec>(r)};
    case NodeKind::BatchNorm:
        return NodeSpec{readSpec<BatchNormSpec>(r)};
    case NodeKind::Linear:
        return NodeSpec{readSpec<LinearSpec>(r)};
    case NodeKind::Activation:
        return NodeSpec{readSpec<ActivationSpec>(r)};
    case NodeKind::IndexedPooling:
        return NodeSpec{readSpec<IndexedPoolingSpec>(r)};
    case NodeKind::Unpooling:
        return NodeSpec{readSpec<UnpoolingSpec>(r)};
    }

    throw std::runtime_error(
        "readModelGraph: 未知の NodeKind (" +
        std::to_string(static_cast<int64_t>(kind)) + ") layer_" + std::to_string(index));
}
} // namespace

void writeModelGraph(torch::serialize::OutputArchive &archive, const ModelGraph &graph)
{
    archive.write("format_version", torch::tensor(kModelGraphArchiveVersion));
    archive.write("node_count", torch::tensor(static_cast<int64_t>(graph.nodes.size())));

    for (std::size_t i = 0; i < graph.nodes.size(); ++i)
    {
        const GraphNode &node = graph.nodes[i];
        const Writer w{archive, nodePrefix(i)};

        w.str("id", node.id);
        writeLayer(archive, i, node.spec);

        w.i64("input_count", static_cast<int64_t>(node.inputs.size()));
        for (std::size_t j = 0; j < node.inputs.size(); ++j)
        {
            const std::string at = "input_" + std::to_string(j) + "_";
            w.str(at + "port", node.inputs[j].port);
            writePortRef(w, at + "source_", node.inputs[j].source);
        }
    }

    const Writer w{archive, ""};
    w.i64("output_count", static_cast<int64_t>(graph.outputs.size()));
    for (std::size_t j = 0; j < graph.outputs.size(); ++j)
    {
        writePortRef(w, "output_" + std::to_string(j) + "_", graph.outputs[j]);
    }
}

ModelGraph readModelGraph(torch::serialize::InputArchive &archive)
{
    at::Tensor versionTensor;
    archive.read("format_version", versionTensor);
    const int64_t version = versionTensor.item<int64_t>();

    // バージョン運用の方針:
    //   - version > 現行 : 新しい ai-engine が書いた checkpoint。レイアウトが
    //     分からないので読めない。ユーザーに更新を促す。
    //   - version < 現行 : 古いレイアウト。将来 kModelGraphArchiveVersion を
    //     上げるときは、ここで version ごとに読み分ける(古い read パスは残す)。
    //     v1 しか無い現在は該当しない。
    if (version > kModelGraphArchiveVersion)
    {
        throw std::runtime_error(
            "readModelGraph: この checkpoint はより新しいフォーマット (v" +
            std::to_string(version) + ") で書かれています。"
            "現在の ai-engine (v" + std::to_string(kModelGraphArchiveVersion) +
            ") では読めません。ai-engine を更新してください。");
    }
    if (version < kModelGraphArchiveVersion)
    {
        throw std::runtime_error(
            "readModelGraph: 未対応の古いフォーマット (v" + std::to_string(version) +
            ") です。現在は v" + std::to_string(kModelGraphArchiveVersion) +
            " のみ対応しています。");
    }

    at::Tensor countTensor;
    archive.read("node_count", countTensor);
    const auto count = static_cast<std::size_t>(countTensor.item<int64_t>());

    ModelGraph graph;
    graph.nodes.reserve(count);
    for (std::size_t i = 0; i < count; ++i)
    {
        const Reader r{archive, nodePrefix(i)};

        GraphNode node;
        node.id = r.str("id");
        node.spec = readLayer(archive, i);

        const auto inputCount = static_cast<std::size_t>(r.i64("input_count"));
        for (std::size_t j = 0; j < inputCount; ++j)
        {
            const std::string at = "input_" + std::to_string(j) + "_";
            node.inputs.push_back(NodeInput{r.str(at + "port"), readPortRef(r, at + "source_")});
        }
        graph.nodes.push_back(std::move(node));
    }

    const Reader r{archive, ""};
    const auto outputCount = static_cast<std::size_t>(r.i64("output_count"));
    for (std::size_t j = 0; j < outputCount; ++j)
    {
        graph.outputs.push_back(readPortRef(r, "output_" + std::to_string(j) + "_"));
    }
    return graph;
}
