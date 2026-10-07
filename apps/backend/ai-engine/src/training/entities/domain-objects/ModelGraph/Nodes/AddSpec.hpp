#pragma once

// 複数の入力を要素ごとに足し合わせるノード(残差接続の合流など)。「情報を混ぜる」ことだけに着目している。設定する値はない。
// 入力ポート x に 2 本以上つなぎ、出力ポート y から和が出る(ポートの定義は NodePorts.hpp)。
// まだ NodeSpec の variant には入れていない(issue の「E. 層の追加」で入れる)。

struct AddSpec
{
};
