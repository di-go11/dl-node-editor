# c++技術書

## virtual関数と純粋仮想関数

| 種類 | 記法 | 実装 | 特徴 |
|---|---|---|---|
| 非virtual関数 | `void foo();` | 必須 | オーバーライド不可、静的束縛 |
| 通常のvirtual関数 | `virtual void foo();` | 必須(基底クラス側に) | オーバーライド可能、動的束縛。派生クラスは再定義してもしなくてもよい |
| 純粋仮想関数 | `virtual void foo() = 0;` | 不要(むしろ持たないのが基本) | オーバーライド**必須**。このクラス自体はインスタンス化できなくなる |

### `= 0`が意味すること

`= 0`は「この関数には実装本体を書かない(vtable上のエントリをnullptrで初期化する)」というコンパイラへの指示。これにより2つの効果が生まれる。

1. **抽象クラス化**: 純粋仮想関数を1つでも持つクラスは「抽象クラス」となり、直接`new`でインスタンス化することはコンパイルエラーになる。
2. **実装の強制**: このクラスを継承する派生クラスは、純粋仮想関数をすべてオーバーライドしない限り、その派生クラス自身も抽象クラスのままになり、インスタンス化できない。

例(`IDatasetRepository.hpp`):
```c++
class IDatasetRepository
{
public:
    virtual ~IDatasetRepository() = default; // 純粋仮想ではなく=default
    virtual BatchData *getBatchData() = 0;
    virtual void reset() = 0;
    virtual bool hasNext() const = 0;
    virtual TrainingBatch getNextBatch() = 0;
};
```

デストラクタだけ`= 0`ではなく`= default`になっている点に注意。仮想デストラクタが必要な理由は、基底クラスのポインタ経由で派生クラスのオブジェクトを`delete`したときに、正しく派生クラスのデストラクタまで呼ばれるようにするため(仮想でないと未定義動作になる)。デストラクタまで純粋仮想にする必要はなく、`virtual`かつ実装を持てば(あるいは`= default`で自動生成させれば)十分。

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

## static_castとCスタイルキャスト

### Cスタイルキャスト(`(型)値`)

```c++
int x = (int)someValue;
```

「型変換のうちできるものを何でもやる」万能ツール。実際には内部で以下のどれになるかをコンパイラが黙って選んでいる。

- `static_cast`(普通の型変換)
- `const_cast`(constを外す)
- `reinterpret_cast`(ビット列をそのまま別の型として解釈する、危険な変換)
- 上記の組み合わせ

`const`を外したり無関係なポインタ型に強引に変換したりしても、コンパイラは警告すら出さないことがある(意図しない危険な変換まで黙って許してしまう)。

### static_cast

```c++
size_t chwIndex = static_cast<size_t>(c) * height * width + ...;
```

「意味的に妥当な変換」だけに限定したキャスト。

- `int` → `size_t`のような、型のルール上意味が通じる変換だけを許可
- `const`を外すような変換は`static_cast`ではできない(`const_cast`が必要になり、意図的に別の関数を使ったことが後で読んでも分かる)
- 無関係なポインタ型同士の変換のような危険な操作も弾かれる

**まとめ**: Cスタイルキャストは「何でも許してしまう(万能だが危険)」、`static_cast`は「安全な変換だけに限定される」。危険な変換を誤って書いてしまうミスを防げ、意図もコードから明確になるため、C++では`static_cast`(や用途に応じた`const_cast`/`reinterpret_cast`/`dynamic_cast`)を使うのが基本。

## size_t

「サイズを取得するモジュール」ではなく、**単なる符号なし整数型**(`int`や`unsigned long`と同じ「型の一種」)。

```c++
size_t count = 10; // ただの符号なし整数
```

### なぜ使うか

- 配列の要素数・メモリ上のバイト数など、サイズや個数を表す値は負にならないので符号なし整数で表現するのが自然
- `std::vector::size()`や`sizeof(...)`など、標準ライブラリの「サイズを返す」関数の戻り値は**すべて`size_t`型**と決まっている
- プラットフォーム(32bit/64bit)によって適切なビット幅が自動的に選ばれる(64bit環境では通常64bit幅)

`int`(符号あり)のまま`size_t`(符号なし)の値と混ぜて計算すると、コンパイラの警告や意図しない挙動(負の値が異常に大きい正の値に化ける等)を招くことがあるため、`static_cast<size_t>(...)`で明示的に変換するのが安全。