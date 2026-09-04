#include "training/entities/domain-objects/ModelGraphFingerprint.hpp"

#include <cstdint>
#include <sstream>
#include <string>
#include <variant>

namespace
{
    struct LayerCanonicalizer
    {
        std::ostringstream &os;

        void operator()(const Conv2DParams &p) const
        {
            os << "conv2d|" << p.inChannels << '|' << p.outChannels << '|'
               << p.kernelSize << '|' << p.stride << '|' << p.padding;
        }

        void operator()(const PoolingParams &p) const
        {
            os << "pool|" << static_cast<int>(p.type) << '|' << p.kernelSize << '|'
               << p.stride << '|' << p.padding;
        }

        void operator()(const BatchNormParams &p) const
        {
            os << "batchnorm|" << p.numFeatures << '|' << p.eps << '|' << p.momentum;
        }

        void operator()(const LinearParams &p) const
        {
            os << "linear|" << p.inFeatures << '|' << p.outFeatures << '|'
               << (p.bias ? 1 : 0);
        }

        void operator()(const ActivationConfig &p) const
        {
            os << "activation|" << static_cast<int>(p.activationType) << '|' << p.dim;
        }
    };

    std::string canonicalString(const ModelGraph &graph)
    {
        std::ostringstream os;
        os << "v1;layers=" << graph.layers.size();
        for (std::size_t i = 0; i < graph.layers.size(); ++i)
        {
            os << ":[" << i << ']';
            std::visit(LayerCanonicalizer{os}, graph.layers[i].params);
        }
        return os.str();
    };

    // FNV - 1a(64bit)。暗号強度は不要で、目的は「構造が違えば別値になる」こと。

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
    };
};

std::string modelGraphFingerprint(const ModelGraph &graph)
{
    return fnv1a64Hex(canonicalString(graph));
}