#pragma once

enum class PortKind
{
    Feature, // 特徴マップ(Conv, Pool, Concat, Addなど)
    Indices, // poolingの位置情報
    Tokens,  // トークン列(Self-Attention / Transformer)
    Any,     // 種類を問わない(Activation, Dropout, Add など)。
             // 入力に置くと Feature / Tokens のどちらもつなげる。
             // 出力に置くと「入力と同じ種類」の意味で、形状推論の側で解決する。
};