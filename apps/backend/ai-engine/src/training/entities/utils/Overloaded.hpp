#pragma once

// std::visit で variant を型ごとに分岐させるための補助。
// 例: std::visit(Overloaded{[](const A &a) { ... }, [](const B &b) { ... }}, v);
template <class... Ts> // ...は可変長テンプレートという。0個以上の型をいくつでも受け取る。typenameでもいい。
struct Overloaded : Ts... // struct Overloaded: A,B,C...
{
    using Ts::operator()...; // 基底のoperator()を全て見えるようにする。
};

// 推論ガイド
template <class... Ts>
Overloaded(Ts...) -> Overloaded<Ts...>; // Overloaded(型Ts...の引数)のように書かれたら、その型はOverloaded<Ts...>と推論する。という宣言。

