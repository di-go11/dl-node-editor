// 層のパラメータなど具体的な値が正しく伝播させるためにポートの形状を定義する。
// ここでは、ポート自体の形状を定義する。具体的な値は

#pragma once
#include <cstdint>
#include <string>
#include <variant>

// 特徴マップ(N,C,H,W)のバッチNを抜いた形状を表す構造体
struct FeatureMapShape
{
    int64_t channels = 0;
    int64_t height = 0;
    int64_t width = 0;
};

// トークン列(N,L,D)のバッチNを抜いた形状を表す構造体
struct TokenSequenceShape
{
    int64_t length = 0;       // トークン数
    int64_t embeddingDim = 0; // 埋め込みの次元
};

using PortShape = std::variant<FeatureMapShape, TokenSequenceShape>;

inline bool operator==(const FeatureMapShape &a, const FeatureMapShape &b)
{
    return a.channels == b.channels && a.height == b.height && a.width == b.width;
}

inline bool operator==(const TokenSequenceShape &a, const TokenSequenceShape &b)
{
    return a.length == b.length && a.embeddingDim == b.embeddingDim;
}

// エラーメッセージ用。例: "特徴マップ (C=64, H=128, W=128)"
inline std::string toString(const FeatureMapShape &s)
{
    return "特徴マップ (C=" + std::to_string(s.channels) + ", H=" + std::to_string(s.height) +
           ", W=" + std::to_string(s.width) + ")";
}

inline std::string toString(const TokenSequenceShape &s)
{
    return "トークン列 (L=" + std::to_string(s.length) + ", D=" + std::to_string(s.embeddingDim) + ")";
}

inline std::string toString(const PortShape &shape)
{
    return std::visit([](const auto &s)
                      { return toString(s); },
                      shape);
}
