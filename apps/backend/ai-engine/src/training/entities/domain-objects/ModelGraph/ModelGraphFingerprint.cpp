#include "training/entities/domain-objects/ModelGraph/ModelGraphFingerprint.hpp"

#include "training/entities/domain-objects/ModelGraph/NodeSpecFields.hpp"

#include <cstdint>
#include <sstream>
#include <string>
#include <type_traits>
#include <variant>

namespace
{
    // 正規化文字列への値の書き出し。
    // enum は整数値、bool は 1/0 に落とす(型が変わっても表現が変わらないように)。
    template <class V>
    void appendValue(std::ostringstream &os, const V &value)
    {
        if constexpr (std::is_same_v<V, bool>)
        {
            os << (value ? 1 : 0);
        }
        else if constexpr (std::is_enum_v<V>)
        {
            os << static_cast<int>(value);
        }
        else
        {
            os << value;
        }
    }

    // 出力ポート 1 つを "ノードID.ポート名" で書く。グラフ入力は nodeId も port も空なので "." になる。
    void appendPortRef(std::ostringstream &os, const PortRef &ref)
    {
        os << ref.nodeId << '.' << ref.port;
    }

    // 例: "v2;nodes=2:[c1]conv2d|3|21|3|1|1|1<x=.:[a1]activation|0|1<x=c1.y;outputs=a1.y"
    //
    // ノードは graph.nodes の並び順のまま書く(実行順に並べ替えない)。
    // 並び順が重みの初期値と parameters() の順番を決めるため、並びが違えば別のモデルとして区別する。
    // 各ノードは「[ID]層の種類|フィールド...<入力ポート=接続元,...」の形で、
    // 同じ層の並びでも、つなぎ方が違えば別の値になる。
    //
    // フィールドの列挙は NodeSpecFields.hpp に一元化してある。
    // この文字列のフォーマット(区切り文字・並び順)を変えると
    // 既存の .pt に記録された fingerprint と一致しなくなるため変更しないこと。
    // (v1 は layers の配列を前提にしていた。DAG 化で作り直したので、v1 の checkpoint とは一致しない)
    std::string canonicalString(const ModelGraph &graph)
    {
        std::ostringstream os;
        os << "v2;nodes=" << graph.nodes.size();

        for (const GraphNode &node : graph.nodes)
        {
            os << ":[" << node.id << ']';

            std::visit(
                [&os](const auto &p)
                {
                    os << nodeKindTag(nodeKindOf(p));
                    visitSpecFields(p,
                                     [&os](const char * /*name*/, const auto &value)
                                     {
                                         os << '|';
                                         appendValue(os, value);
                                     });
                },
                node.spec);

            // 入力の接続。ノード ID の文字種は英数字・'-'・'_' に限られるので、'<' '=' ',' '.' と衝突しない。
            char separator = '<';
            for (const NodeInput &input : node.inputs)
            {
                os << separator << input.port << '=';
                appendPortRef(os, input.source);
                separator = ',';
            }
        }

        os << ";outputs=";
        for (std::size_t i = 0; i < graph.outputs.size(); ++i)
        {
            if (i > 0)
            {
                os << ',';
            }
            appendPortRef(os, graph.outputs[i]);
        }

        return os.str();
    }

    // FNV-1a(64bit)。暗号強度は不要で、目的は「構造が違えば別値になる」こと。
    std::string fnv1a64Hex(const std::string &data)
    {
        std::uint64_t hash = 1469598103934665603ULL; // offset basis

        for (unsigned char c : data)
        {
            hash ^= static_cast<std::uint64_t>(c);
            hash *= 1099511628211ULL; // prime
        }

        static const char *digits = "0123456789abcdef";
        std::string out(16, '0');

        for (int i = 15; i >= 0; --i)
        {
            out[i] = digits[hash & 0x0f];
            hash >>= 4;
        }
        return out;
    }
} // namespace

std::string modelGraphFingerprint(const ModelGraph &graph)
{
    return fnv1a64Hex(canonicalString(graph));
}
