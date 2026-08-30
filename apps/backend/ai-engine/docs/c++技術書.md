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

## using

`using`は綴りこそ同じだが、文法上は**別々の5つの機能**に使い回されているキーワード。「名前をどう扱うか」を制御する道具、と捉えると整理しやすい。

| # | 機能名 | 記法 | 何をするか |
|---|---|---|---|
| (a) | 型エイリアス宣言 | `using Size = std::pair<int,int>;` | 既存の型に別名を付ける(`typedef`の現代版) |
| (b) | using宣言 | `using std::vector;` | 別スコープ(名前空間・基底クラス・enum)の**特定の1名前**を現スコープに引き込む |
| (c) | usingディレクティブ | `using namespace std;` | 名前空間の**全名前**を見えるようにする(名前空間専用) |
| (d) | 継承コンテキストのusing宣言 | `using Base::Base;` / `using Base::foo;` | 基底クラスのコンストラクタを継承、または隠れたメンバを可視化・アクセス変更 |
| (e) | using enum宣言(C++20) | `using enum ResizePolicy;` | スコープ付きenumの**全列挙子**を現スコープに引き込む |

### (a) 型エイリアス宣言

```c++
using Size = std::pair<int, int>;   // = 型 の形。型に新しい名前を付ける
using LayerPtr = std::shared_ptr<ILayer>;
```

`typedef std::pair<int,int> Size;`と等価だが、`using`版は左辺=右辺で読みやすく、かつテンプレートを部分的に固定した「エイリアステンプレート」も書ける点で上位互換。

```c++
template <class T>
using Vec = std::vector<T, MyAllocator<T>>;   // typedefではこれが書けない
```

### (b) using宣言 — 名前を1つ引き込む

```c++
using std::vector;    // 以降 vector を std:: なしで書ける
vector<int> v;
```

- ヘッダのグローバルスコープで多用すると、そのヘッダをincludeした全ファイルに名前が漏れて衝突の温床になる。関数内などスコープを絞って使うのが基本。
- enumの列挙子1つだけを引き込む用途にも使える: `using ResizePolicy::Warp;`

### (c) usingディレクティブ

```c++
using namespace std;   // std の名前を「全部」可視化
```

**名前空間専用**。利便性は高いが、どの名前がどこ由来か不明瞭になり衝突リスクも大きい。**ヘッダでは絶対に書かない**。`.cpp`のローカルでも、必要なものを(b)で個別に引き込むほうが安全。

### (d) 継承コンテキストのusing宣言

```c++
class Derived : public Base {
public:
    using Base::Base;   // 基底クラスのコンストラクタ群をそのまま継承する
    using Base::foo;    // 基底の foo が Derived の別オーバーロードに隠された場合に再可視化
                        // / protected メンバを public に昇格する等のアクセス調整
};
```

本プロジェクトの**オーバーロードセットイディオム**([TorchLayerBuilder.cpp](../src/training/infrastructure/torchFunc/TorchLayerBuilder.cpp))でも使用:

```c++
template <class... Ts>
struct Overloaded : Ts...
{
    using Ts::operator()...;   // 多重継承した各ラムダの operator() を
                               // すべて同じスコープに集めて1つの呼び出し可能物にする
};
```

`using Ts::operator()...;`はパラメータパック展開を伴う(d)の形。継承した複数の基底それぞれの`operator()`を、名前解決の対象としてまとめて可視化している。

### (e) using enum宣言(C++20)

```c++
using enum ResizePolicy;   // Warp, Letterbox, CenterCrop を現スコープに引き込む
ResizePolicy p = Warp;     // ResizePolicy::Warp と書かずに済む
```

#### なぜ `enum` キーワードを付けるのか

1. **「1個取り込み」と「全部取り込み」を区別するため**。列挙子1つだけなら従来の(b)で`using ResizePolicy::Warp;`と書けた。「enumの中身を全部いっぺんに」はC++20で新設された別文法(using-enum-declaration)であり、既存構文と衝突しない目印として`enum`を置く。
2. **`using 型名;` 単独では意味をなさないため**。型エイリアス(a)は`= `必須、using宣言(b)は「別スコープの名前を引き込む」ものでその型はすでに現スコープにある。`enum`を明示して初めて「列挙子を全展開するのだ」と一意に解釈できる。
3. **`enum ResizePolicy` / `class Widget` という既存の書き方(elaborated-type-specifier)と綴りを合わせている**。「`enum ResizePolicy`を`using`する」と読める一貫性。

#### 使いどころと注意

- スコープを絞れる。長い`switch`文で`ResizePolicy::`の繰り返しが冗長なとき、関数内やクラス内に限定して使うと可読性が上がる。
- **ヘッダのグローバルスコープでは使わない**。`enum class`が持つ「囲みスコープを汚さない」利点を自ら捨てることになる。
- 複数のenumを同じスコープで`using enum`し、同名の列挙子があると曖昧エラーになる。
- 原則は`ResizePolicy::Warp`とフル修飾。`using enum`はあくまで局所的な省略手段。

### 補足: `enum class` と裸の列挙子

`enum class`(スコープ付き列挙)の列挙子は囲みスコープに漏れないため、**必ず型名で修飾**する。

```c++
enum class ResizePolicy { Warp, Letterbox, CenterCrop };

ResizePolicy p1 = Warp;               // ✗ 'Warp' は未宣言
ResizePolicy p2 = ResizePolicy::Warp; // ○
```

裸で`Warp`と書けるのは「素の`enum`にする」「`using enum`する」「`using ResizePolicy::Warp;`する」のいずれかを行った場合だけ。デフォルトメンバー初期化子でも同じ規則が適用される。

```c++
struct ResizeParam {
    ResizePolicy resizePolicy = ResizePolicy::Warp;   // フル修飾が必要
};
```

## 参照を返す関数 / 値を返す関数 と const

`ImageData`(entities層)のアクセサ設計を例に整理する。

```c++
class ImageData {
public:
    uint8_t  at(size_t c, size_t y, size_t x) const;   // (A) 値を返す・読み取り専用
    uint8_t &at(size_t c, size_t y, size_t x);         // (B) 参照を返す・読み書き両用

    const std::vector<uint8_t> &raw()   const;         // (C) const参照を返す
    const std::vector<size_t>  &shape() const;
private:
    std::vector<size_t>  _shape;
    std::vector<uint8_t> _values;   // CHW平坦
};
```

### 1. 値を返す vs 参照を返す

| | 値を返す `T foo();` | 参照を返す `T& foo();` |
|---|---|---|
| 戻り値の正体 | 呼び出しごとに作られる**独立したコピー**(一時オブジェクト = rvalue) | 既存オブジェクトへの**別名**(lvalue) |
| コピーコスト | あり(型が大きいほど高い) | なし(アドレスを渡すだけ) |
| 代入の左辺に置けるか | ✗(`foo() = x;` はコンパイルエラー) | ✅(`foo() = x;` で参照先の実体が書き換わる) |
| 呼び出し側での書き換え | 受け取ったコピーが変わるだけで元に影響なし | **オブジェクト内部の実データが直接変わる** |

```c++
ImageData img = decoder.decode(path);

img.at(0,10,20) = 255;          // (B) 参照返し → _values の該当要素に 255 が書き込まれる
uint8_t v = img.at(0,10,20);    // (B) の戻り参照から uint8_t にコピー

const ImageData &ref = img;
uint8_t w = ref.at(0,10,20);    // (A) が呼ばれる(読み取りのみ)
// ref.at(0,10,20) = 0;         // ✗ (A) の戻り値はコピー。左辺に置けない
```

`std::vector` の `operator[]` が `v[3] = 10;` と書けるのは `T&` を返しているから。同じ原理。

### 2. lvalue / rvalue

C++の式は **lvalue(名前や記憶場所を持ち、代入の左辺に置ける)** と **rvalue(一時的な値)** に分かれる。
参照を返す関数の呼び出し式は「その参照が指すオブジェクトそのもの」を表すため **lvalue** になり、変数名と同じように振る舞う。値を返す関数の呼び出し式は一時オブジェクト = rvalue。

### 3. 参照を返すときの必須ルール: ダングリング参照を作らない

参照は「既に存在するオブジェクトの別名」なので、**関数終了後もその実体が生きている**必要がある。

```c++
uint8_t &bad() {
    uint8_t local = 42;
    return local;                       // ✗ 未定義動作。local は関数終了で破棄される
}

uint8_t &ImageData::at(size_t c, size_t y, size_t x) {
    return _values[index(c, y, x)];     // ○ _values はメンバ。オブジェクトの寿命に従う
}
```

参照で返してよいもの: メンバ変数(`this`経由)、オブジェクトが保持するコンテナの要素、`static`/グローバル、引数で受けた参照そのもの。
返してはいけないもの: ローカル変数、関数内で作った一時オブジェクト。

### 4. 参照返しを使う2つの動機

- **書き込み口の提供**: `(B)` のように `img.at(...) = value;` を可能にする。値返しでは代入先にならない。
- **コピーコストの回避**: `(C)` の `raw()` は数MBの `vector` をコピーせず渡す。ただし外部からの書き換えを防ぐため **`const` 参照** にして「見るだけ」に限定する。

| 戻り方 | コピー | 読み | 書き | 主な用途 |
|---|---|---|---|---|
| 値 `T` | あり | ○ | ―(左辺不可) | 小さい値。`const`メソッドで内部実体を外に漏らしたくないとき |
| 参照 `T&` | なし | ○ | ○ | 要素への書き込み口(`operator[]`等) |
| const参照 `const T&` | なし | ○ | ✗ | 大きいオブジェクトを効率よく渡す(読み取り専用) |

### 5. メンバ関数の `const` は2か所あり、意味が別

```c++
      uint8_t at(size_t c, size_t y, size_t x) const;
//    ^^^^^^^ (1)戻り値の型               (2)末尾の const ^^^^^
```

#### (1) 戻り値に付ける `const` — 値返しなら通常は不要

`const uint8_t at(...)` の先頭 `const`。戻り値がコピー(rvalue)なら、もともと代入の左辺に置けず、呼び出し側は自分の変数にコピーして使うだけなので **意味がほぼ無い**(組み込み型では特に)。付けない。

#### (2) 末尾の `const` — 「このメンバ関数はオブジェクトを変更しない」という約束。戻り値とは無関係

- 実体は「隠れた引数 `this` の型が `const ImageData*` になる」ということ。
- **`const` オブジェクト / `const` 参照から呼べるのは末尾 `const` 付きメソッドだけ**。

```c++
NormalizedImageData ImageNormalizer::normalize(const ImageData &image) {
    uint8_t v = image.at(c, y, x);   // image は const。末尾 const の (A) でないと呼べない
}
```

末尾 `const` が無いと「オブジェクトを書き換えるかもしれない関数」とみなされ、読み取り専用の文脈(`const ImageData&`)で一切使えなくなる。これが **const 正しさ(const-correctness)**。

### 6. const オーバーロード

末尾の `const` は**関数シグネチャの一部**なので、引数リストが同じでも別関数として共存できる。

```c++
uint8_t  at(size_t c, size_t y, size_t x) const;   // (A)
uint8_t &at(size_t c, size_t y, size_t x);         // (B)
```

- `const` オブジェクト → (A) しか呼べない(読み取り専用)
- 非 `const` オブジェクト → (B) が優先(読み書き可)
- (戻り値の型 `uint8_t` と `uint8_t&` の違いはオーバーロード解決には使われない。区別しているのは末尾 `const` の有無)
- (A) から末尾 `const` を外すと2本が同一シグネチャになり **再定義エラー**。

この2本立てにより「読むだけの側は `const` 参照で受けて (A) しか使えない / 生成する側だけ非 `const` の (B) で書き込む」という区別がコンパイラレベルで強制でき、どこがオブジェクトを書き換えるかが型から追える。

### 7. 実装の重複を避ける

(A)(B) で添字計算を二重に書かないよう、`private` なヘルパに計算を集約して両者から呼ぶ(C++17)。

```c++
size_t ImageData::index(size_t c, size_t y, size_t x) const {
    return c * _shape[1] * _shape[2] + y * _shape[2] + x;
}
uint8_t &ImageData::at(size_t c, size_t y, size_t x)       { return _values[index(c,y,x)]; }
uint8_t  ImageData::at(size_t c, size_t y, size_t x) const { return _values[index(c,y,x)]; }
```

C++23 なら "deducing this"(明示的オブジェクトパラメータ)で1本にまとめられる。

```c++
template <class Self>
auto &&at(this Self &&self, size_t c, size_t y, size_t x) {
    return std::forward<Self>(self)._values[self.index(c, y, x)];
}
```

### 8. `*this` を返すパターン

参照返しの応用。自分自身を返してメソッドチェーンを可能にする。

```c++
Builder &setWidth(int w)  { _w = w; return *this; }
Builder &setHeight(int h) { _h = h; return *this; }
builder.setWidth(640).setHeight(640);
```

`operator=` が `T&` を返すのも、`a = b = c;`(= `a = (b = c)`)を成立させるため。同じ理屈。

## 値カテゴリ(lvalue / rvalue)

C++の式(expression)はすべて**値カテゴリ**を持つ。ムーブセマンティクスと参照束縛の土台になる概念。

### 1. 由来と直感

もとは代入 `=` を基準にした呼び方。

```c++
a = 10;
// ^   ^
// │   └ 右辺(right)  = rvalue
// └ 左辺(left)       = lvalue
```

現代的には「**名前(identity)を持ち、後からもう一度参照できるか**」で判断する。

| | lvalue | rvalue |
|---|---|---|
| 直感 | 名前がついた実体。式が終わっても残る | 名前のない一時的な値。その場限りで消える |
| アドレスを取れる(`&`) | 取れる | 取れない |
| 代入の左辺に置ける | 置ける | 置けない |
| 例 | 変数、`*ptr`、`arr[i]`、参照を返す関数呼び出し | リテラル、算術式の結果、値を返す関数呼び出し、`std::move(x)` |

### 2. 具体例

```c++
int a = 10;         // a は lvalue、10 は rvalue

a = 20;             // OK: 左辺が lvalue
20 = a;             // ✗ 左辺が rvalue
int *p = &a;        // OK: lvalue のアドレスは取れる
int *q = &10;       // ✗ rvalue のアドレスは取れない
int b = a + 5;      // (a + 5) は rvalue(計算結果の一時オブジェクト)

std::vector<int> make();
std::vector<int> v;
v;                  // lvalue(名前のある変数)
make();             // rvalue(戻り値の一時オブジェクト)
std::move(v);       // rvalue(v を一時オブジェクト扱いにキャストした式)
```

### 3. なぜ重要か — 参照の束縛ルール

値カテゴリは「どの参照にどの式を渡せるか」を決める。

```c++
void f(std::vector<int> &r);        // 非const lvalue 参照
void g(const std::vector<int> &r);  // const lvalue 参照
void h(std::vector<int> &&r);       // rvalue 参照

std::vector<int> v;
f(v);              // OK
f(make());         // ✗ 一時オブジェクト(rvalue)は非const lvalue 参照に束縛できない
g(v);              // OK
g(make());         // OK  const参照は rvalue も受けられる(寿命も式の終わりまで延長)
h(v);              // ✗ lvalue は rvalue 参照に束縛できない
h(make());         // OK
h(std::move(v));   // OK  std::move で v を rvalue にキャストしたから
```

- `const&` … lvalue も rvalue も受けられるが**中身を奪えない**(常にコピー)
- `&&` … **中身を奪える**が rvalue しか受けられない
- 値渡し … 両方受けられ、内部で `std::move` すればムーブに乗せられる

### 4. ムーブとの関係

**rvalue = 「これから消える一時オブジェクトなので中身を奪っても誰も困らない」** という保証。だからコンパイラは rvalue が渡されたときだけムーブを選ぶ。lvalue(名前のある変数)は後で使うかもしれないのでコピーが選ばれる。`std::move(x)` は「この `x` はもう使わないと約束するので rvalue 扱いにしてくれ」という明示キャスト。

### 5. 補足: 厳密には5カテゴリ

C++11以降、基本3種(**lvalue** / **prvalue** 純粋な一時値 / **xvalue** 消滅間近のlvalue = `std::move(v)` 等)と、複合2種(**glvalue** = lvalue+xvalue / **rvalue** = prvalue+xvalue)。日常的には「lvalue(名前があり残る)」「rvalue(名前がなく消える)」の2分法で足りる。細かい区別が要るのはムーブやライブラリ実装を書くとき。

## 右辺値参照 `T&&` の使い方

### 1. ムーブコンストラクタ / ムーブ代入

一番の目的。消えていく一時オブジェクト(rvalue)を受け取り、内部リソースを奪う。

```c++
class Buffer {
    uint8_t *_data;
    size_t   _size;
public:
    Buffer(Buffer &&other) noexcept
        : _data(other._data), _size(other._size)   // ポインタを盗む
    {
        other._data = nullptr;   // 抜け殻を「有効な空状態」にする
        other._size = 0;         // (デストラクタが delete しても安全なように)
    }

    Buffer &operator=(Buffer &&other) noexcept {
        if (this != &other) {
            delete[] _data;                // 自分の既存リソースを解放
            _data = other._data;  _size = other._size;
            other._data = nullptr; other._size = 0;
        }
        return *this;                      // T& を返す(a = b = c; のため)
    }
};
```

メンバが `std::vector` などムーブ可能な型だけで、デストラクタ・コピー・ムーブを自分で宣言していないクラス(例: `ImageData`)は、**ムーブ操作が暗黙生成**されるので手書き不要。手書きが要るのは生ポインタ・`FILE*`・ソケット等を直接持つクラス。

### 2. 「ムーブコンストラクタ」と「引数をメンバに格納するコンストラクタ」は別物

よくある混同。両方 `std::move` が絡むが、目的も引数の決め方も違う。

| | ムーブコンストラクタ `T(T&& other)` | 引数を格納する通常コンストラクタ |
|---|---|---|
| 目的 | 「この型にとってのムーブ」を**定義**する特殊メンバ関数 | 外部データを受け取ってオブジェクトを組み立てる |
| 引数の型 | **`T&&` 固定**(言語仕様で決まっており変えられない) | 自由。第一選択は値渡し |
| `std::move` の使い所 | 中で `other` のメンバを基底/メンバへ転送するとき | メンバ初期化子で引数をメンバへ入れるとき |
| `ImageData` では | **書いていない**(暗黙生成) | これが `ImageData(std::vector<size_t>, std::vector<uint8_t>)` |

```c++
// これはムーブコンストラクタではない。ただの「2つの vector を受け取って作る」通常コンストラクタ
ImageData::ImageData(std::vector<size_t> shape, std::vector<uint8_t> values)
    : _shape(std::move(shape)), _values(std::move(values)) { }
```

- 通常コンストラクタで引数をメンバに格納するだけなら、引数を `T&&` にする義務はない。値渡し + `std::move`(sink parameter イディオム)で lvalue/rvalue 両対応できる。
- `ImageData` の**ムーブコンストラクタ**(`ImageData(ImageData&&)`)は、メンバが `std::vector` 2本だけでコピー/デストラクタ/ムーブのどれも自分で宣言していないため、**コンパイラが暗黙生成**する(各メンバを順にムーブするだけ)。手書き不要。
- 自分でムーブコンストラクタを書く必要があるのは、生ポインタ・`FILE*`・ソケット等、「ムーブを知っている型」でないリソースを直接持つクラス。その場合は引数が `T&&` 必須で、かつ中で `std::move(other._member)` も必要(次項)。

補足: ムーブセマンティクス(ムーブコンストラクタ・右辺値参照・`std::move`)はすべて **C++11 で追加**された。C++03 以前や C言語にはムーブの概念自体がなく、コピーか swap で代用していた。

### 3. 【落とし穴】名前のついた右辺値参照は lvalue

```c++
void foo(std::string &&s) {
    // s は「rvalue 参照型」だが、s という名前で何度も参照できる → s 自体は lvalue
    bar(s);              // bar(const std::string&) → コピー
    bar(std::move(s));   // bar(std::string&&)      → ムーブ
}
```

「rvalue 参照で受けた」だけではムーブされない。**その先へ渡すときにもう一度 `std::move`** が必要。ムーブコンストラクタでメンバが `vector` 等なら:

```c++
Widget(Widget &&other) noexcept
    : _name(std::move(other._name))   // other._name は lvalue。std::move しないとコピー
{ }
```

### 4. 完全転送(perfect forwarding)※ 別物

テンプレートで `T&&`(`T` がその関数で推論される場合)は右辺値参照ではなく**転送参照(forwarding reference)**という別機能になる。

```c++
template <class T>
void wrapper(T &&arg) {                 // 転送参照
    inner(std::forward<T>(arg));        // 元の lvalue/rvalue 性を保ったまま渡す
}
```

- `wrapper(v)` → `T = std::vector<int>&`、`arg` は lvalue 参照
- `wrapper(std::move(v))` → `T = std::vector<int>`、`arg` は rvalue 参照
- `std::forward<T>` は「元が rvalue のときだけ `std::move` 相当」になるキャスト

`std::vector<int>&&`(具体型)や非テンプレート関数の `&&` は普通の右辺値参照。`T&&` かつ `T` がその関数で推論される場合だけ転送参照。

### 5. `noexcept` を付ける理由

ムーブ操作は `noexcept` にする。`std::vector` が再確保するとき、要素のムーブが `noexcept` でないと「途中で例外が出たら復元できない」ため**コピーにフォールバック**する。`noexcept` を付けて初めてムーブ高速化が効く。

### 6. 使い分けまとめ

| やりたいこと | 手段 |
|---|---|
| リソースを持つクラスの高速な移動 | ムーブコンストラクタ / ムーブ代入(`T&&`) |
| 受け取った引数を別関数へ素通し(テンプレート) | 転送参照 `T&&` + `std::forward<T>` |
| lvalue を強制的に「奪ってよい」印にする | `std::move`(= `static_cast<T&&>`) |
| 関数の引数をメンバ・コンテナに保管する / lvalue・rvalue 両対応 | 下の **「引数の渡し方(オブジェクト・配列)」** を参照 |

## std::move とムーブセマンティクス

### 1. `std::move` は「移動」しない — ただのキャスト

名前に反して、`std::move(x)` は**何も動かさない**。実体は

```c++
static_cast<T&&>(x)   // x を「右辺値参照」に型変換するだけ
```

やっているのは「この `x` はもう使わないので中身を奪ってよい」という**印(rvalue)を付ける**ことだけ。この印が付くと、オーバーロード解決で**コピーコンストラクタの代わりにムーブコンストラクタ / ムーブ代入**が選ばれる。

### 2. 実際の「移動」はムーブコンストラクタの仕事

| | コピーコンストラクタ | ムーブコンストラクタ |
|---|---|---|
| `std::vector` の場合の処理 | 新しいヒープ領域を確保して全要素をコピー | 相手の内部ポインタ・size・capacity を自分にコピーし、相手を空(nullptr,0,0)にする |
| 計算量 | O(n) + メモリ確保 | O(1)。要素コピーもヒープ確保もなし |

`vector` が大きいほど差が効く。画像バッファ(数MB)を渡すときは特に。

### 3. lvalue / rvalue とムーブの関係

- **lvalue**(名前を持つ変数)は「まだ使うかもしれない」ので、そのまま渡すとコピーが選ばれる。
- **rvalue**(一時オブジェクト、`std::move` した式)は「使い捨て」なので、ムーブが選ばれる。
- 関数の戻り値(名前のない一時オブジェクト)は元々 rvalue なので、`return する側で std::move は不要`(むしろ RVO を妨げるので付けない)。

```c++
std::vector<int> make();
std::vector<int> a = make();            // 戻り値は rvalue → ムーブ(実際は RVO でコピーもムーブも省略)
std::vector<int> b = a;                 // a は lvalue → コピー
std::vector<int> c = std::move(a);      // a を rvalue にキャスト → ムーブ。以降 a は空
```

### 4. ムーブ後の変数は触らない

move された変数は「**有効だが不定の状態(valid but unspecified)**」になる。`std::vector` は空になることが保証されるが、原則として**値を読まず、再代入か破棄だけ**行う。

```c++
std::vector<int> a{1,2,3};
std::vector<int> b = std::move(a);
// a は空。a を読むな。a = {...} で入れ直すのは OK
```

### 5. move が速度に効く条件

「① もうその変数の値を使わない」「② そこで実際にコピーが発生する(格納先がある)」「③ ムーブがコピーより軽い型(`vector` / `string` / `unique_ptr` など、ヒープ等のリソースを所有する型)」の**3つが揃ったときだけ**速くなる。

- `int` / `double` / 小さい `struct` は move = copy。付けても効果ゼロなので付けない。
- 関数の**戻り値**では付けない(§3。RVO を妨げるだけ)。
- move 後の変数は触らない(§4)。

引数をどう受け取り、どこで move するかの実践は次章にまとめる。

## 引数の渡し方(オブジェクト・配列)

`std::vector` や自作クラスなど「コピーが高価な型」を関数引数で受け取るとき、どう宣言すれば無駄が出ないか。判断は **「関数がその引数をどう扱うか」** で決まる。`int` など小さい自明な型は下記に関係なく値渡しでよい(コピーが安く、間接参照も消える)。

### 0. 判断表

| 関数がその引数を… | 受け取り方 | 例 |
|---|---|---|
| **読むだけ**(観測する) | `const T&` | `ImageNormalizer::normalize(const ImageData&)` / `IImagePreprocessor::process(const ImageData&)` |
| **メンバ・コンテナに保管する**(sink) | **値渡し `T`** → 初期化子リストで `std::move` | `ImageData(std::vector<size_t>, std::vector<uint8_t>)` |
| ローカルで**改変するが保管はしない** | 値渡し `T` | ソートして返す関数など |
| 呼び出し側のオブジェクトを**その場で書き換える**(in/out) | `T&`(非const参照) | 出力バッファを埋める関数 |
| 保管するかどうか**条件による** | `const T&` と `T&&` の2オーバーロード(テンプレなら転送参照) | 稀 |

以下、配列・オブジェクトで問題になる上2つを詳しく。

### 1. 読むだけ → `const T&`

```c++
NormalizedImageData ImageNormalizer::normalize(const ImageData &image);  // image を読んで別物を作るだけ
```

| 呼び出し側 | コスト |
|---|---|
| lvalue を渡す | 参照が直接束縛。**コピーゼロ** |
| rvalue を渡す | 同上。コピーゼロ |

- **保管しないなら値渡しにしてはいけない**。値渡しにすると lvalue 実引数で必ずコピーが1回発生する。`const T&` なら0。
- `const T&` は lvalue も rvalue も受けられる(§値カテゴリ)。一時オブジェクトの寿命も式の終わりまで延びる。
- ただし**中身を奪えない**。読み取り専用だからそれでよい。

### 2. メンバ・コンテナに保管する → 値渡し + `std::move`(sink parameter イディオム)

メンバは自分のデータを**所有**する(参照メンバはダングリングするので不可)。したがって引数の中身をメンバへ「コピーかムーブで移す」ことは必須で、無駄ではない。問題は**その移し方**。

```c++
ImageData::ImageData(std::vector<size_t> shape, std::vector<uint8_t> values)  // 値渡しで受ける
    : _shape(std::move(shape)), _values(std::move(values))                    // 初期化子リストで move
{ }
```

- 引数 `values` はこのコンストラクタ専用のローカル変数で、抜けたら破棄される。**名前を持つので lvalue**。
- `_values(values)` と書くと lvalue → コピーコンストラクタ(ヒープ確保 + 全要素複製)。直後に引数は捨てられるので完全な無駄。
- `_values(std::move(values))` で rvalue にキャスト → ムーブコンストラクタ(ポインタ付け替え、O(1))。
- **コンストラクタ本体 `{}` の中で `_values = std::move(values);` と書くと、メンバが先にデフォルト構築されてから代入される(2手間)。必ず初期化子リスト `: _values(...)` で。**

#### 無駄が出るか出ないか — 受け取り方 × 呼び出し側

| 受け取り方 | lvalue を渡す(呼び出し側も使い続ける) | rvalue を渡す(`std::move` / 一時オブジェクト) |
|---|---|---|
| `const T&` + メンバにコピー | ディープコピー1(**不可避。無駄ではない**) | ディープコピー1(**無駄**。ムーブで足りるのにコピーしている) |
| **値渡し + `std::move`** | ディープコピー1 + 安いムーブ1 | 安いムーブ2(**ディープコピーゼロ**) |
| `const T&` と `T&&` の2本 | ディープコピー1 | 安いムーブ1 |

- `const T&` + コピーは、**rvalue を渡されたときにムーブできる機会をコピーで潰す**。lvalue には最適だが両対応にならない。
- `T&&` だけにすると lvalue 実引数を弾く。両対応には引数ごとに `const&` / `&&` の2オーバーロード = 引数 n 個で 2ⁿ 本。
- **値渡し + `std::move` は1関数で両対応**でき、`const T&` + コピー版に比べて lvalue 時に「安いムーブ1回」増えるだけ(`vector` なら無視できる)、rvalue 時はディープコピーを完全に消せる。だからこれが定番。

### 3. コンテナへ入れる場合(`push_back` / `emplace_back`)

「メンバに保管」と同じ話。lvalue のまま渡すとコピー、`std::move` すればムーブ。

```c++
ImageData image = decoder.decode(path);     // 戻り値(rvalue) → image はムーブ構築(RVO で省略され得る)
batch.values.push_back(std::move(image));   // image の中身を vector 内の要素へムーブ。以降 image は使わない
```

- `push_back(image)` … lvalue なので**まるごとコピー**。
- `push_back(std::move(image))` … ポインタ付け替えだけ。
- `emplace_back(引数...)` … 要素を vector 内で**直接構築**(引数を転送)。`batch.values.emplace_back(std::move(shape), std::move(values));`
- デフォルトコンストラクタを持たない型(不変条件を検証する `ImageData` 等)でも `push_back` / `emplace_back` は**構築済みオブジェクトを入れる操作なので動く**。動かないのは `vector<T>::resize(n)` のように**要素を新規デフォルト構築する操作**だけ。

### 4. private メンバのコンテナへの追加はメソッド経由

カプセル化してコンテナメンバを private にしたら、外から `push_back` はできない。§2 と同じ「値渡し + `std::move`」でメソッドを用意する。

```c++
class BatchData {
public:
    void addSample(ImageData img) { _values.push_back(std::move(img)); }  // 値渡し + move
private:
    std::vector<ImageData> _values;
};
```

呼び出し側は `batch.addSample(std::move(image));`。

### 5. 戻り値は別問題 — RVO に任せる

「引数を move してメンバに入れ、加工して return」する設計と、「`const T& input, T& output` で出力引数に書く」設計のどちらが速いか、という比較になることがある。**単発呼び出しならほぼ差はない**(戻り値は RVO でコピーもムーブも消える)。差が出るのは「同じサイズの出力バッファを大量のループで使い回す」ケースだけで、そのとき初めて出力引数(`T&`)方式に確保回数の利点が出る。通常は**値返し + 内部で `std::move`** が、合成可能・エイリアシング事故なし・呼び出し側が出力を用意しなくてよい、という点で優る。

```c++
ImageData resize(const ImageData &input) const {
    std::vector<uint8_t> out(C * nH * nW);        // 出力サイズが違うので確保は1回不可避
    // ... out に書き込む ...
    return ImageData({C, nH, nW}, std::move(out));  // return では std::move(local) は書かない…が
                                                    // これは「一時オブジェクトを引数に渡す」ので move で正しい
}
```

- `return result;`(`result` はローカル変数)→ **`std::move` を付けない**。NRVO が効かなくなる。
- `return ImageData(a, std::move(b));` のように **return 式の中で一時オブジェクトを組み立てる**場合の `std::move` は別物で、これは正しい(引数への受け渡しだから)。

### 6. おすすめ早見表(オブジェクト・配列)

| 場面 | 受け取り方 |
|---|---|
| 引数を読むだけ | `const T&`(大きい型) / 値渡し(`int` 等の小さい自明な型) |
| 引数をメンバ・コンテナに保管する | **値渡し + `std::move` + 初期化子リスト** |
| 引数のローカルコピーを加工する(保管しない) | 値渡し |
| 呼び出し側のオブジェクトをその場で書き換える | `T&` |
| 結果を呼び出し側へ返す | 値返し(RVO に任せる。`return std::move(local)` は書かない) |
| 同サイズ出力を大量ループで使い回す(実測でボトルネックのときだけ) | `T& output` 出力引数 |