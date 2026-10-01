#pragma once

enum class PortKind
{
    Feature, // 特徴マップ(Conv, Pool, Concat, Addなど)
    Indices, // poolingの位置情報
};