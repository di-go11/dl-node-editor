#pragma once

// 複数の入力を要素ごとに足し合わせるノード(残差接続の合流など)。形は変わらない。
// 入力ポート x に 2 本以上つなぎ、出力ポート y から和が出る(ポートの定義は NodePorts.hpp)。
//
// alpha: 2 番目以降の入力にかける係数。y = x0 + alpha * x1 + alpha * x2 + ...(x0 には掛けない)。
//        既定の 1.0 なら単純な和。

struct AddSpec
{
    double alpha = 1.0;
};
