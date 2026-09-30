#pragma once

// std::visit で variant を型ごとに分岐させるための補助。
// 例: std::visit(Overloaded{[](const A &a) { ... }, [](const B &b) { ... }}, v);
// 各 .cpp で個別に定義すると、このヘッダーを include したときに再定義エラーになるため、ここに1つだけ置く。
template <class... Ts>
struct Overloaded : Ts...
{
    using Ts::operator()...;
};
template <class... Ts>
Overloaded(Ts...) -> Overloaded<Ts...>;
