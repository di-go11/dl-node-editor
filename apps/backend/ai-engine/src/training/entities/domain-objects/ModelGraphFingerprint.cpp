#include "training/entities/domain-objects/ModelGraphFingerprint.hpp"

#include "training/entities/domain-objects/LayersParamsFields.hpp"

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

    // 例: "v1;layers=2:[0]conv2d|3|21|3|1|1:[1]activation|0|1"
    //
    // フィールドの列挙は LayersParamsFields.hpp に一元化してある。
    // この文字列のフォーマット(区切り文字・並び順)を変えると
    // 既存の .pt に記録された fingerprint と一致しなくなるため変更しないこと。
    std::string canonicalString(const ModelGraph &graph)
    {
        std::ostringstream os;
        os << "v1;layers=" << graph.layers.size();

        for (std::size_t i = 0; i < graph.layers.size(); ++i)
        {
            os << ":[" << i << ']';

            std::visit(
                [&os](const auto &p)
                {
                    os << layerKindTag(layerKindOf(p));
                    visitLayerFields(p,
                                     [&os](const char * /*name*/, const auto &value)
                                     {
                                         os << '|';
                                         appendValue(os, value);
                                     });
                },
                graph.layers[i].params);
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
