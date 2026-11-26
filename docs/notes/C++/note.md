# c++のノート

## 標準ライブラリ

### `std::uniform_int_distribution`

`<random>`にあるクラスで、指定した範囲の整数を同じ確率で一つ選ぶ。

```cpp
#include <random>

std::mt19937_64 rng(seed);                          // 乱数生成器(乱数のもとを作る)
std::uniform_int_distribution<int> dist(0, 10);     // 0〜10 の整数を同じ確率で

int x = dist(rng);                                  // 0, 1, …, 10 のどれか
```

## 便利な


### `std::variant`と`template`をつかったOverloadパターンとVisitorパターン

```cpp
template <class... Ts> // ...は可変長テンプレートという。0個以上の型をいくつでも受け取る。typenameでもいい。
struct Overloaded : Ts... // struct Overloaded: A,B,C...
{
    using Ts::operator()...; // 基底のoperator()を全て見えるようにする。
};

// 推論ガイド
template <class... Ts>
Overloaded(Ts...) -> Overloaded<Ts...>; // Overloaded(型Ts...の引数)のように書かれたら、その型はOverloaded<Ts...>と推論する。という宣言。
```

- operator()の基底クラスを継承して、スコープ上で見えるようにする。

```cpp
template <class... Ts> // ...は可変長テンプレートという。0個以上の型をいくつでも受け取る。typenameでもいい。
struct Overloaded : Ts... // struct Overloaded: A,B,C... ラムダ関数を基底クラスとして継承する。
{
    using Ts::operator()...; // 基底のoperator()を全て見えるようにする。
};
```

1. Overloadedは基底クラスのラムダ関数を全て継承する。
2. `using Ts::operator()...;`でOperatorが見えるようになり、引数の型で処理を選べる。


- 型推論を可能にする。

```cpp
template <class... Ts>
Overloaded(Ts...) -> Overloaded<Ts...>; // Overloaded(型Ts...の引数)のように書かれたら、その型はOverloaded<Ts...>と推論する。という宣言。
```