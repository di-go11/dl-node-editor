# c++技術書

## std::variantとstd::visit

### std::variant
`#include <variant>`必須
`std::variant<型1, 型2, 型3,...>`

「複数の型のうちどれか一つを保持できる箱」

例:
```c++
std::variant<int, double, std::string> v; //デフォルトコンストラクタでは第1引数の型がデフォルトで構築される。このvariantではint(0)
v = 42;              // int を保持
v = 3.14;             // double を保持(前の値は破棄される)
v = std::string("hi"); // std::string を保持
```

### std::visit(型に応じて処理を分岐)

`std::visit(呼び出し可能なもの, variant変数)`

- 第1引数: `variant`が今保持している型の値を受け取って処理する関数(ラムダ, 関数オブジェクト, 関数ポインタなど)
- 第2引数; 対象の`std::variant`変数
- `variant`が実際に保持している型を判定し、その型の値を引数として第1引数の関数を呼び出す

### std::holds_alternative<T>(今どの型が入っているか確認)

```c++
if(std::holds_alternative<int>(v)){
    // trueの場合variantvは現在int
}
```

### std::get<T> / std::get<インデックス (値を取り出す)

```c++
int x = std::get<int>(v);       // 型指定で取得(違う型ならstd::bad_variant_access例外)
int x = std::get<0>(v);         // インデックス指定でも取得可能(0番目=int)
```

### std::get_if<T> (例外を投げずにポインタで安全に取得)

```c++
if (int* p = std::get_if<int>(&v)) {
    std::cout << *p << std::endl; // 保持していればポインタ、違えばnullptr
}
```


## オーバーロードセットイディオム(TorchLayerBuilder.hppにて使用)

GoFパターンの内、visitorパターンの一つを実現するための道具。

オーバーロードセットの定義コード
```c++
namespace{ // 無名名前空間 そのcppだけで使う名前区間
template <class... Ts>
struct Overloaded : Ts...       // 複数の型(ラムダ)を多重継承
{
    using Ts::operator()...;    // それぞれのoperator()を全部同じスコープに引き込む。ラムダ式1つ1つはコンパイラが自動生成する「operator()を持つ無名クラス」
};
// 推論ガイド。本来テンプレートクラスは型をすべて書く必要があるが、ラムダの方は無名クラスなため、書きようがない。
template <class... Ts> // 任意の個数で任意の型を受け取れる
Overloaded(Ts...) -> Overloaded<Ts...>;  // CTAD(クラステンプレート実引数推論、C++17)
}
```

オーバーロードセットの使用例

```c++
        Overloaded{
            [](const Conv2DParams &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchConv2DLayer>(p);
            },
            [](const PoolingParams &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchPoolingLayer>(p);
            },
            [](const BatchNormParams &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchBatchNormLayer>(p);
            },
            [](const LinearParams &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchLinearLayer>(p);
            },
            [](const ActivationParams &p) -> std::shared_ptr<ILayer>
            {
                return std::make_shared<TorchActivationLayer>(p);
            },
        },
```


### templateとは

ジェネリックプログラミングの仕組みで、「型をあとから決められるコード」を書くための機能。関数やクラスを具体的な型を決めずに一度書いておき、実際に使うときに呼び出し側の型に合わせてコンパイラが実態を生成してくれる

```c++

template <class T>
T maxValue(T a, T b){
    return a > b ? a : b;
}

maxValue(3, 5);        // T = int として実体化
maxValue(3.5, 2.1);    // T = double として実体化
maxValue(std::string("a"), std::string("b")); // T = std::string として実体化
```

int用,double用,std::string用と3つ別々に関数を書かなくても一つの定義で済む。Tはプレースホルダーで呼び出されたときの実引数の型からコンパイラが自動的に推論する。(**これをテンプレート実引数推論**)という。

```c++
template <class... T>
```
通常、`class T`は「1つの型」を受け取るが、このように定義したときは、「0個以上の、任意の個数の型」をまとめて受け取れる。このパラメータ自体を**パラメータパック**とよび、この機能を**可変長テンプレート**とよぶ。

### visitor パターンとは

型ごとに異なる処理を、型のクラス階層を汚さず外側から適応すること