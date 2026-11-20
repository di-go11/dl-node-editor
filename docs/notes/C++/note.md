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