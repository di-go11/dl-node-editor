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

## 演算子

### operator()

`operator()`は**関数呼び出し演算子**で、「オブジェクトを関数のように呼べるようにする」ための特殊なメンバ関数。

#### operotor()がない場合

受けとる側が、呼び出すメソッド名を決め打ちするしか無い。

```cpp
#include <iostream>
#include <vector>

// 受け取る側: 「run というメソッドがある型」しか受け付けられない
template <class T>
void applyAll(const std::vector<int> &xs, T &obj)
{
    for (int x : xs) {
        std::cout << obj.run(x) << "\n";     // ← メソッド名 run を決め打ち
    }
}

struct Adder {
    int base;
    int run(int x) const { return x + base; }        // run
};

struct Multiplier {
    int factor;
    int execute(int x) const { return x * factor; }  // execute (別の人が別の名前で作った)
};

int main()
{
    std::vector<int> xs{1, 2, 3};

    Adder add10{10};
    applyAll(xs, add10);        // ○ run があるので動く

    Multiplier times3{3};
    applyAll(xs, times3);       // ✗ コンパイルエラー: 'Multiplier' に 'run' が無い
}
```
`Multiplier`は同じ「intを受けてintを返す処理」なのに、メソッド名が`execute`なので`applyAll`から呼べず、コンパイルエラーになる。

これを解決するには?
- `Multiplier`のメソッド名を`run`に統一する
- `applyAll`を`execute`用にもう一本書く(冗長)
- 共通の基底クラス(`IProcessor`)を作って継承させる(すべての型に継承を強いる)
- 普通の関数(`int triple(int)`)や、他のライブラリはメソッドを持たないため渡せない

#### operator()がある場合

呼び出しの書き方を`f(x)`に決めておく。

```cpp
#include <iostream>
#include <vector>

// 受け取る側: 「f(x) と書ける型」なら何でも受け付ける
template <class F>
void applyAll(const std::vector<int> &xs, F &&f) 
{
    for (int x : xs) {
        std::cout << f(x) << "\n";           // ← 呼び出し構文 f(x) だけを前提にする
    }
}

struct Adder {
    int base;
    int operator()(int x) const { return x + base; }
};

struct Multiplier {
    int factor;
    int operator()(int x) const { return x * factor; }
};

int square(int x) { return x * x; }          // ただの関数

int main()
{
    std::vector<int> xs{1, 2, 3};

    applyAll(xs, Adder{10});                              // ○ クラス
    applyAll(xs, Multiplier{3});                          // ○ 別のクラス
    applyAll(xs, square);                                 // ○ 普通の関数
    applyAll(xs, [](int x) { return x - 1; });            // ○ ラムダ
    int offset = 100;
    applyAll(xs, [offset](int x) { return x + offset; }); // ○ 状態を持つラムダ
}
```

- `Adder{10}`: 変数に入れていない=一時オブジェクトと呼ばれるオブジェクトを生成する。このオブジェクトはその式が終わる(`;`が来る)まで生存している。
- `F &&f`: 「右辺値参照」なため、変数ではなく右辺文を受け取るため、今回は`Adder{10}`のような一時オブジェクトを直接渡せる。`F f`だとコピーが発生するため、コピーコンストラクタがないクラスは渡せない。

## 標準ライブラリ

### std::variantとstd::visit

#### std::variant
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

#### std::visit(型に応じて処理を分岐)

`std::visit(visitor, variant)`

- 第1引数: `variant`が今保持している型の値を受け取って処理する関数(ラムダ, 関数オブジェクト, 関数ポインタなど)
- 第2引数; 対象の`std::variant`変数
- `variant`が実際に保持している型を判定し、その型の値を引数として第1引数の関数を呼び出す。デザインパターンでの**visitorパターン**をC++で実現したもの。

##### ジェネリックラムダ `[](const auto &c) -> 複数の型を生成できるクラスor構造体`

- 引数型`auto`を使うことで、どの型が来ても呼び出せる。**テンプレート化されたラムダ関数(c++14以降)**。実体としてはコンパイラが`operator()`をテンプレートメンバ関数として持つ無名クラスを生成し、`std::visit`は`variant`が実際に保持している方で、そのテンプレートを暗黙にインスタンス化する。`->`の後ろは戻り値型を保証するための構文。

```cpp
std::visit([](const auto &c) -> std::shared_ptr<ILayer> {
    return std::make_shared<TorchConv2DLayer>(c);
}, v);
```

###### [](ラムダ導入子とキャプチャ)

`[]`は**ラムダ式の始まりを示す記号=ラムダ導入子**。中に書くものを**キャプチャリスト**と呼ぶ。「ラムダの外にある変数のうち、どれをラムダの中に持ち込むか」を指定する。

```cpp
int base = 10;
auto f = [base](int x) -> int {return x + base;};
```

これは次のクラスと同じ。

```cpp
class 無名クラス{
private:
    int base;
public:
    explicit 無名クラス(int b) : base(b) {}
    int operator()(int x) const {return x + base;}
};
```
つまり、キャプチャは「無名クラスのメンバ変数として何を保持させるか」の指定。

|書き方|意味|
|---|---|
|`[]`|何も持ち込まない(状態を持たないラムダ)|
|`[x]`|変数 `x` を値コピーで持ち込む|
|`[&x]`|変数 `x` を参照で持ち込む|
|`[=]`|ラムダの外にある変数をすべて値コピーで持ち込む|
|`[&]`|ラムダの外にある変数をすべて参照で持ち込む|
|`[this]`|囲んでいるクラスの`this`を持ち込む|


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

### std::min 

- `#include <algorithm>`必須

２つの値のうち小さい方を返す。テンプレート化されているため、型に依存せず使える。

```c++
#include <algorithm>

int a = 10, b = 20;

std::cout << std::min(a, b) << std::endl; // 10
```

### スレッド操作

#### std::mutex

- `#include <mutex>`必須

##### namespace宣言

本クラスは`std`名前空間に属するため、`std::mutex`と書く必要がある。`using namespace std;`を使うと`mutex`だけで書けるようになる。

```c++
namespace std {
    class mutex;
}
```

##### 概要

`std::mutex`は「排他制御のためのロック」を提供するクラス。複数のスレッドが同じ変数に同時にアクセスするのを防ぐクラスである。`lock()`メンバ関数によってリソースのロックを取得し、`unlock()`メンバ関数でリソースのロックを手放す。このクラスのデストラクタは自動的に`unlock()`メンバ関数を呼び出すことはないため、**通常このクラスのメンバ関数は直接呼び出さず**、`lock_guard`や`unique_lock`といったロック管理クラスと併用する。

##### メンバ関数一覧

| 名前 | 説明 | 対応バージョン|
|---|---|---|
|(`(constructor)`)[https://cpprefjp.github.io/reference/mutex/mutex/op_constructor.html]| コンストラクタ | C++11|
|(`(destructor)`)[https://cpprefjp.github.io/reference/mutex/mutex/op_destructor.html]|| デストラクタ | C++11|
|`operator=(const mutex&) = delete;`| コピー代入演算子 | C++11|
|`lock`|ロックを取得する| C++11|
|`try_lock`|ロックを取得できればtrue、できなければfalseを返す| C++11|
|`unlock`|ロックを解放する| C++11|
|`native_handle`|ネイティブハンドルを取得する| C++11|

##### ロック管理クラス

|名前|説明|
|---|---|
|`lock_guard`|途中で外すことができない。処理が軽い。|
|`unique_lock:unlock()`|途中で外したり、またかけ直したりできる。そのぶん処理が重い。|

##### 使用例

ソースコード

```c++
#include <iostream>
#include <thread>
#include <mutex>
#include <vector>

class X {
  std::mutex mtx_;
  std::vector<int> data_;
public:
  // vectorオブジェクトへのアクセスを排他的にする
  void add_value(int value)
  {
    std::lock_guard<std::mutex> lock(mtx_);
    data_.push_back(value);
  }

  void print()
  {
    for (int x : data_) {
      std::cout << x << std::endl;
    }
  }
};

int main()
{
  X x;

  std::thread t1([&x]{ x.add_value(1); });
  std::thread t2([&x]{ x.add_value(2); });

  t1.join();
  t2.join();

  x.print();
}
```

出力

```c++
1
2
```

#### 対応バージョン

- 言語
  - c++11
- 処理系
　- Clang:10.0.1
  - GCC: 4.7.0
  - Visual C++: 2012,2013,2015

#### std::thread

- `#include <thread>`必須

```c++
namespace std {
    class thread;
}
```

##### 概要

クラス`thread`は、新しい実行のスレッドの作成/待機/その他操作を行う機構を提供する。

###### threadオブジェクトとスレッドとの関係性

`thread`オブジェクトとスレッドは1:1の関係で対応付けられるが、両者は同一ではないことに留意。`thread`コンストラクタによって新しく生成されたスレッドは、その`thread`オブジェクトに関係づけられる。
`thread`コンストラクタでは新しいスレッドを1つ作成し、同コンストラクタを呼び出したスレッドはそのまま後続処理を続ける。一方で、新しいスレッド上では`thread`コンストラクタに与えた関数オブジェクトが呼び出される。つまりプログラム内に複数のスレッドが存在し、平行にそれぞれの処理を行うことが可能となる。なお、複数のスレッドが真に並行実行されるか否かは**処理系に依存する**。(例えば、2Core環境で4つのスレッドを作成することは可能だが、同時処理されるのは2スレッド以下に制限される。)

新しいスレッド上で呼び出される関数オブジェクトから例外が投げられた場合、`std::terminate()`が呼び出されてプログラムは終了する。

また、デフォルト構築された`thread`オブジェクトは、何も指さないからの`thread`オブジェクトとなる。

###### join操作とdetach操作

`thread`オブジェクトとスレッドが関連付けられた状態では、`thread`オブジェクトのメンバ関数`join()`を介してそのスレッド完了を待機することができる(join操作)。メンバ関数`join()`が呼び出された時点で`thread`オブジェクトに関連付けられたスレッドがまだ処理継続中だった場合、その対象スレッドが完了するまで呼び出し元スレッドがブロックされる。このjoin操作が終わった`thred`オブジェクトは、何も指さない空の`thread`オブジェクトとなる。

##### メンバ関数

|名前|説明|対応バージョン|
|---|---|---|
|`(constructor)`|コンストラクタ|C++11|
|`(destructor)`|デストラクタ|C++11|
|`operator=(const thread&) = delete;`|コピー代入演算子|C++11|
|`swap`|別の`thread`オブジェクトと入れ替える|C++11|
|`joinable`|スレッドがjoin可能かどうかを返す|C++11|
|`join`|スレッドの完了を待機する|C++11|
|`detach`|スレッドをデタッチする|C++11|
|`get_id`|関連付けられているスレッドのスレッド識別子を取得する|C++11|
|`hardware_concurrency`|同時に実行可能なスレッド数を返す|C++11|

静的メンバ関数

|名前|説明|対応バージョン|
|---|---|---|
|`hardware_concurrency`|処理系(GCC,Clangなど)によりサポートされるスレッド並行数を取得する。|C++11|

##### メンバ型

|名前|説明|対応バージョン|
|---|---|---|
|`id`|スレッド識別子(class)|C++11|
|`native_handle_type`|ネイティブハンドルの型|C++11|
|`name_hint`|スレッド名を設定するスレッド属性(class template)|C++29|
|`stack_size_hint`|スレッドスタックサイズを設定するスレッド属性(class)|C++29|

##### 非メンバ関数

|名前|説明|対応バージョン|
|---|---|---|
|`swap`|2つの`thread`オブジェクトを入れ替える|C++11|

##### 使い方

```c++
#include <cassert>
#include <thread>

int main()
{
    int x = 0, y=0;
    std::thread t([&]{++x;});
    --y;
    t.join();
    assert(x == 1 && y == -1);
    return 0;
}
```

### std::function

- `#include <functional>`必須

#### 概要

「呼び出せるもの(関数、ラムダ、関数オブジェクトなど)を、中身の種類を問わず、統一した型として、持ち運べるようにする」標準ライブラリのクラス

呼び出せるものリスト
```cpp
void freeFunction(int x) { ... }                    // 普通の関数
auto lambda = [](int x) { ... };                     // ラムダ式
struct Functor { void operator()(int x) { ... } };    // 関数オブジェクト(operator() を持つクラス)
```

これらは、それぞれ、違う型。ラムダ式は、コンパイラが呼び出しごとに、無名の専用の型を作るため、その型に、名前をつけることができない。

```cpp
auto lambda = [](int x) { ... }; // lambdaの型は無名クラス
```

`std::function`はこの違いを、吸収して **「引数と戻り値の形が、同じなら、同じ値として扱える箱」**を提供する。

```cpp
std::function<void(int)> f = freeFunction; // 引数がintで戻り値がvoidの関数
f = lambda; // ラムダの代入
f = Functor(); // 関数オブジェクト
f(5); // どれも同じように呼び出せる
```

#### 型の書き方

```cpp
std::function<戻り値の型(引数の型1, 引数の型2, ...)>
```


## キーワード(C++20)

| 分類 | キーワード | 役割 |
|---|---|---|
| 基本型 | `bool` `char` `char8_t`(C++20) `char16_t` `char32_t` `wchar_t` `short` `int` `long` `signed` `unsigned` `float` `double` `void` | 組み込み型の名前 |
| 型の指定・推論 | `auto` `decltype` | 型をコンパイラに推論させる / 式の型を取得する |
| 型修飾・定数 | `const` `volatile` `mutable` `constexpr` `consteval`(C++20) `constinit`(C++20) | 変更不可、最適化抑制、`const` 内での変更許可、コンパイル時評価の指定 |
| 記憶域・リンケージ | `static` `extern` `thread_local` `inline` `register`(C++17で廃止) | 寿命、可視範囲(リンケージ)、ODR の扱いの指定 |
| 型の定義 | `class` `struct` `union` `enum` `typedef` | ユーザー定義型・型の別名の宣言 |
| 名前空間・名前の導入 | `namespace` `using` | 名前の区切りと引き込み |
| アクセス制御 | `public` `protected` `private` `friend` | メンバの公開範囲、特別な許可 |
| クラスの振る舞い | `virtual` `explicit` `this` `operator` | 動的束縛、暗黙変換の禁止、自オブジェクトへのポインタ、演算子関数の名前 |
| テンプレート | `template` `typename` `concept`(C++20) `requires`(C++20) | 型を後から決めるコード、型への制約 |
| 制御構文 | `if` `else` `switch` `case` `default` `for` `while` `do` `break` `continue` `goto` `return` | 分岐・繰り返し・脱出 |
| 例外 | `try` `catch` `throw` `noexcept` | 例外の送出・捕捉、例外を投げない約束 |
| 動的メモリ | `new` `delete` | ヒープの確保と解放 |
| キャスト | `static_cast` `dynamic_cast` `const_cast` `reinterpret_cast` | 用途別の型変換 |
| コンパイル時の問い合わせ | `sizeof` `alignof` `alignas` `typeid` `static_assert` | サイズ・アライメント・型情報の取得、コンパイル時の検証 |
| リテラル | `true` `false` `nullptr` | 真偽値、ヌルポインタ |
| コルーチン(C++20) | `co_await` `co_yield` `co_return` | コルーチンの中断・生成・終了 |
| その他 | `asm` `export` | インラインアセンブリ、モジュールの公開(C++20) |

### 型指定・推論

#### auto

`auto`は「型をコンパイラに推論させる」ためのキーワード。変数宣言のときに使う。

#### decltype

`decltype`は「式の型を取得する」ためのキーワード。変数宣言のときに使う

### 型修飾・定数

#### constexpr

`constexpr`は「コンパイル時に評価できる」ことを宣言するキーワード。

||意味|値が決まる時期|
|---|---|---|
|`const`|「初期化後に変更しない」という約束|コンパイル時でも実行時でもいい|
|`constexpr`|「コンパイル時に決まる定数」であることの保証|必ずコンパイル時|

```cpp
int n = readFromFile();

const int a = n; //値は変更しないが、値は実行時に決まる。
constexpr int b = n; // ✘ nはコンパイル時に決まらないためエラー。
constexpr int c = 10; // ○ 10はコンパイル時に決まる。
int array[c]; // ○ cはコンパイル時に決まるため、配列のサイズとして使える。
int buf2[a]; // ✘ aはコンパイル時に決まらないため、配列のサイズとして使えない。
```

### std::optional

```c++
namespace std {
  template <class T>
  class optional;

  // 参照に対する部分特殊化 (C++26)
  template <class T>
  class optional<T&>;


  // viewコンセプトを有効化する (C++26)
  template<class T>
  constexpr bool ranges::enable_view<optional<T>> = true;

  // std::formatによるフォーマットを無効化する (C++26)
  template<class T>
  constexpr auto format_kind<optional<T>> = range_format::disabled;

  // borrowed_rangeコンセプトを有効化する (C++26)
  template<class T>
  constexpr bool ranges::enable_borrowed_range<optional<T&>> = true;
}
```

#### 概要

`optional`クラスは、任意の型`T`の値を有効値として、あらゆる型に共通の無効値状態を表現できる型。

このクラスには、大きく2つの用途がある:
1. オブジェクトの初期化タイミングを遅延させる。
2. エラー報告のために、あらゆる型に共通の無効値表現をもたせる

オブジェクトは定義した時点で初期化が行われるが、`optional`クラスはその初期化タイミングを遅延させるために使用できる。この用途には、`std::shared_ptr`のようなスマートポインタを使用することもできるが(インターフェースで戻り値を統一させて、std::make_sharedで戻り値として吐き出させたりしてポリモーフィズムを実現したり...)、このクラスは動的メモリ確保を行わないため、リソース管理ではなく初期化タイミングを遅延させるだけであれば、このクラスのほうが適している。

#### テンプレートパラメータ制約

プライマリテンプレート`optional<T>`の型`T`が以下のいずれかに該当してはならない。

- 参照型
- (CV修飾された)`std::in_place_t`
- (CV修飾された)`std::nullopt_t`
また、型`T`は`std::destructible`である必要がある。

#### メンバ関数

代入
|名前|説明|対応バージョン|
|---|---|---|
|`operator=`|代入演算子|C++17|
|`emplace`|要素型のコンストラクタ引数から直接構築する|C++17|
|`swap`|別の`optional`オブジェクトと入れ替える|C++17|
|`reset`|有効地を保持していない状態にする|C++17|

### テンプレート

テンプレートは、型を後から決めるコードを書くための機能。関数やクラスを具体的な型を決めずに一度書いておき、実際に使うときに呼び出し側の型に合わせてコンパイラが実態を生成してくれる。

#### template

同じ処理を型ごとに書き直すのは無駄

```cpp
int maxValue(int a, int b){
    return a > b ? a : b;
}
double maxValue(double a, double b){
    return a > b ? a : b;
}
```

型安全のまま使い回すために`template`が生まれた。

```cpp
template <class T>

T maxValue(T a, T b){
    return a > b ? a : b;
}
```

- `template <...>`: は実体ではなく、設計図。使われるまで、コードが生成されない。
- 呼び出しで`T`が決まると、コンパイラがその型で実体を作る=インスタンス化。

```cpp
maxValue(3, 5);        // T = int として実体化
maxValue(3.5, 2.1);    // T = double として実体化
```

※引数はコンパイラで推論されるが、戻り値は推論されないため明示する必要あり。

```cpp
convert<double>(3); // intをdoubleに変換する
convert<double,int>(3.5); // doubleをintに変換する
convert(3); //コンパイルエラー
```

##### templateの種類

|種類|例|備考|
|---|---|---|
|関数テンプレート|`template <class T> T maxValue(T a, T b)`|引数から`T`を推論できる|
|クラステンプレート|`template <class T> class MyClass { ... }`|`MyClass<int>`のようにインスタンス化の時に型を明示する。|
|変数テンプレート|`template <class T> constexpr T pi = T{3.14159};`||
|エイリアステンプレート|`template <class T> using Vec = std::vector<T, A<T>>;`||
|メンバテンプレート|クラスの中の`template <class U> void f(U);`||

##### 可変長テンプレート

```cpp
template <class... T>
struct Overloaded : TS... {using Ts::operator()...;};
```

`...`でパックを宣言し、使う側の`...`で展開する。

### クラスの振る舞い

#### explicit

`explicit`は、「1引数で呼び出せるコンストラクタ」が**暗黙の型変換に使われてしまうのを防ぐ**ためのキーワード。

C++では、一つの引数で呼び出し可能なコンストラクタ(他の引数がデフォルト値をもつ場合も同様)は、何も指定しなければ暗黙の変換コンストラクタとして扱われる。つまり、`MyCalss(int x)`のようなコンストラクタを持つクラスがある場合、コンパイラは、`int`型の値を`MyClass`型に自動変換してしまう。

具体的には以下のようなコードが意図せずコンパイラを通ってしまうことがある。

```cpp
void process(MyClass obj);

class Myclass {
public:
    MyClass(int x) { ... } // 暗黙の変換コンストラクタ
}

int x = 42;

process(x); // xはMyClassに暗黙的に変換される 本来、xはint型であり、MyClass型のオブジェクトを作る意図はないのに、コンパイラが自動的に変換してしまう
```

よって、
```cpp
class MyClass {
    public:
        explicit MyClass(int x) { ... } // 暗黙の変換を防ぐ
}
```
デフォルト値を持たない変数の個数が一つの場合、`explicit`をつけなければいけない。

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

## static

`static` は `using` と同様、**綴りは同じだが「どこに書くか」で全く別の意味になる**キーワード。4つの機能に分かれる。

| # | 使い方 | 書く場所 | 意味 |
|---|---|---|---|
| (a) | static メンバ関数 | クラス定義内の関数 | インスタンス(`this`)に属さない関数。メンバ変数に触れない |
| (b) | static メンバ変数 | クラス定義内の変数 | クラスに1つだけ存在する変数(インスタンスごとではない) |
| (c) | static ローカル変数 | 関数本体内の変数 | 初回通過時に1度だけ初期化され、以降も値を保持し続ける |
| (d) | 内部リンケージ指定 | ファイルスコープの関数・変数 | その翻訳単位(`.cpp`)の中だけで可視。他ファイルから不可視 |

補足: `static_cast` / `static_assert` は綴りに `static` を含むが、上記とは無関係の別キーワード。

### (a) static メンバ関数 — `this` を持たない関数

```c++
class BatchTensorConverter {
    static const std::vector<std::size_t> &sampleShape(const ImageData &sample) {
        return sample.shape();   // 引数だけを見る。BatchTensorConverter のメンバには触れない
    }
};
```

通常のメンバ関数は隠れ引数として `this`(そのオブジェクトのアドレス)を受け取る。`static` を付けると**`this` を受け取らない**関数になる。

| 性質 | 内容 |
|---|---|
| 非 static メンバへのアクセス | **不可**(メンバ変数・非 static メンバ関数を使うとコンパイルエラー) |
| 呼び出し方 | `BatchTensorConverter::sampleShape(x)`(インスタンス経由 `conv.sampleShape(x)` も文法上は可だがオブジェクトは使われない) |
| `virtual` | **不可**。多態は `this` の実型に基づくため。純粋仮想 `= 0` も不可 |
| 末尾 `const` | **付けられない**。`this` が無く「オブジェクトを変更しない」という概念自体が存在しない |

#### 何のために使うか

- **ファクトリ関数**(`static Foo create(...)`): オブジェクトがまだ無い段階で呼ぶ
- **状態非依存の内部ヘルパー**: 「メンバに触れない」ことを**コンパイラに保証させる**(最小権限の原則。コメントで書くだけでは後から破られる)
- static メンバ関数からは static メンバ関数しか呼べない(呼ぶ対象のオブジェクトが無いため)。結果、ヘルパー階層が連鎖的に static になる

#### static にするかの判断フロー

```
その関数はメンバ変数を…
├─ 変更する                              → 非 static・非 const
├─ 読むだけ                              → 非 static・const   ★static ではない
└─ まったく触れない
   ├─ virtual / override が必要          → 非 static(static は多態不可)
   ├─ 公開APIでオブジェクトの振る舞いとして見せたい
   │   / インターフェースでモック差し替えしたい → 非 static
   └─ それ以外(内部ヘルパー等)          → static
```

`const`(メンバを読むが変更しない)と `static`(メンバに一切触れない)の混同に注意。「変更しないから」で `static` にすると、実はメンバを読んでいたときにエラーになる。

本プロジェクトの [BatchTensorConverter](../src/training/adapters/impl/BatchTensorConverter.hpp) の `private static` ヘルパー群(`sampleShape` / `appendValues` / `flattenValues` 等)は「内部専用・メンバに触れない・多態不要」の3条件が揃った例。

### (b) static メンバ変数 — クラスに1つだけの変数

```c++
class Counter {
public:
    Counter()  { ++_alive; }
    ~Counter() { --_alive; }
    static int alive() { return _alive; }
private:
    inline static int _alive = 0;   // C++17: ヘッダ内で定義まで完結できる
};
```

- インスタンスごとではなく**クラス全体で1つ**の記憶域。全オブジェクトが共有する
- **C++17 より前**: クラス内は「宣言」だけで、どこか1つの `.cpp` に「定義」`int Counter::_alive = 0;` を書く必要がある(ODR: One Definition Rule)。書き忘れるとリンクエラー
- **C++17 の `inline static`**: ヘッダ内で定義まで完結できる。`static constexpr` は暗黙で `inline`(定数はこれが定番)

```c++
class ImageConfig {
    static constexpr int kMaxChannels = 4;   // 宣言=定義。.cpp 不要
};
```

- 用途: 定数、全インスタンス共有のカウンタ・キャッシュ、シングルトンの実体
- 注意: 異なる翻訳単位にまたがる名前空間スコープの static オブジェクトは**初期化順序が未規定**(static initialization order fiasco)。定数以外の複雑な static は、次の (c) の関数内 static に寄せると初期化順序を制御できる

### (c) 関数内 static ローカル変数 — 一度だけ初期化して保持

```c++
const Config &defaultConfig() {
    static const Config instance = loadConfigFromFile();  // 最初の呼び出し時に1度だけ実行
    return instance;                                       // 2回目以降は既存を返す
}
```

- 記憶域はプログラム起動〜終了まで存在するが、**初期化は制御が初めてその宣言を通過したとき**に行われる(遅延初期化)
- 破棄はプログラム終了時(構築と逆順)
- **C++11 以降、この初期化はスレッドセーフ**であることが保証される(複数スレッドが同時に初回呼び出ししても初期化は1回だけ、他方は完了を待つ)。いわゆる magic static

```c++
// Meyers' Singleton
class Logger {
public:
    static Logger &instance() {
        static Logger inst;   // 初回 instance() 呼び出し時に構築、以降同じものを返す
        return inst;
    }
private:
    Logger() = default;
};
```

- 用途: シングルトン、高コストな値の遅延初期化・キャッシュ
- 注意: 関数が**隠れた状態**を持つことになる。呼び出し順で挙動が変わる/テスト間で状態が持ち越されるため、多用しない

### (d) 内部リンケージの static — その `.cpp` 限定にする

```c++
// Foo.cpp
static int helperCount = 0;                // この .cpp の中だけで見える
static void logInternal(const char *msg);  // 他の .cpp からは参照・リンクできない
```

- 名前空間スコープ(グローバル)の関数・変数に付けると**内部リンケージ**になり、その翻訳単位限定になる
- 目的: 他ファイルの同名シンボルとの衝突を防ぐ、実装詳細を外に漏らさない
- **ヘッダには書かない**。include した各 `.cpp` がそれぞれ別の実体を持ってしまう
- 現代C++では**無名名前空間**が推奨されることが多い(型にも使える、テンプレートと相性が良い)。本プロジェクトの [TorchLayerBuilder.cpp](../src/training/infrastructure/torchFunc/TorchLayerBuilder.cpp) の `Overloaded` は無名名前空間側に置かれている。関数・変数単体なら `static` でも実用上十分

### まとめ

| 場面 | 使う static |
|---|---|
| クラスに属すが特定インスタンスに属さない関数(ファクトリ、状態非依存ヘルパー) | (a) static メンバ関数 |
| 全インスタンスで共有する値・定数 | (b) static メンバ変数(C++17 は `inline static` / `static constexpr`) |
| 関数をまたいで保持する値・遅延初期化・シングルトン | (c) 関数内 static ローカル変数 |
| その `.cpp` 内だけで使う関数・変数 | (d) 内部リンケージ(型を含むなら無名名前空間) |

迷いやすい対比:

- 「メンバを**読むだけ**」→ `static` ではなく末尾 `const`
- 「`.cpp` 限定にしたい**型**」→ `static` ではなく無名名前空間



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

## final

クラス宣言につけると「**これ以上継承できない**」という指定。

```proto
class GreeterServiceImpl final : public Greeter::Service {}
```

- GreeterServiceImplを継承した子クラスを作ろうとするとコンパイルエラーになる
- 「このサービス実装はここで完結させる、これ以上拡張しない」という意図を明示する
- 副次的な効果として、コンパイラが仮想関数呼び出しを最適化しやすくなる場合がある



## スマートポインタ(`unique_ptr` / `shared_ptr` と `make_unique` / `make_shared`)

### 0. 用語の前提 — 「所有権(ownership)」

「あるオブジェクトを**所有する**」とは、**そのオブジェクトを最終的に破棄(`delete`)する責任を持つ**こと。C++ には GC が無いので、動的確保(ヒープ上)したオブジェクトは「誰が所有者か」を常に1つに定めないと、

- **メモリリーク**: 誰も `delete` しない
- **二重解放**: 2人が `delete` する
- **ダングリング参照**: `delete` 済みのアドレスを他方が使い続ける

のいずれかが起きる。スマートポインタは「所有権を型で表現し、破棄を自動化する」ための道具。RAII(Resource Acquisition Is Initialization = リソースの確保・解放をオブジェクトの寿命に紐づける)の典型例。

### 1. 生ポインタの何が問題か

```c++
TorchModel *p = new TorchModel(graph, builder);
doSomething();     // ← ここで例外が飛ぶと下の delete に到達しない → リーク
delete p;
```

`new` が返す `TorchModel*` は**ただのアドレスの数値**で、「所有権」の情報を持たない。誰が・いつ `delete` するかはコード規約でしか表現できず、例外・早期 return で簡単に破綻する。

### 2. `std::unique_ptr<T>` — 単独所有

`#include <memory>`

「このオブジェクトの所有者は**常にちょうど1人**」を表す。

```c++
auto a = std::make_unique<TorchModel>(graph, builder);  // a が唯一の所有者
auto b = a;              // ✗ コンパイルエラー(コピー禁止)
auto c = std::move(a);   // ○ 所有権が c へ移動。a は nullptr になる(抜け殻)
```

| 性質 | 内容 |
|---|---|
| コピー | **禁止**(コピーコンストラクタ・コピー代入が `delete` 定義されている) |
| ムーブ | 可能。所有権が移り、元は `nullptr` になる |
| サイズ | ポインタ1個分(ステートレスなデリータなら)。生ポインタと同じ |
| 実行時コスト | **ゼロ**。参照カウントもロックも無い |
| 破棄 | `unique_ptr` 自身がスコープを抜ける / `reset()` された瞬間に対象を `delete` |

**コピーできないこと自体が「所有者は1人」の保証**になっている。所有者が1人と確定しているから参照カウントが不要で、オーバーヘッドが無い。「生ポインタを安全にしただけのもの」と考えてよい。

関数の戻り値で所有権を渡すのは自然にできる(ムーブ):

```c++
std::unique_ptr<IModel> createModel() {
    return std::make_unique<TorchModel>(graph, builder);  // 所有権が呼び出し側へ移動
}
```

### 3. `std::shared_ptr<T>` — 共有所有

「このオブジェクトを**複数の主体が同時に所有**し、**最後の1人がいなくなったら**破棄する」を表す。

```c++
auto a = std::make_shared<TorchModel>(graph, builder);  // 参照カウント = 1
{
    auto b = a;          // コピー。同じ本体を指す。カウント = 2
    b->train(/*...*/);   // 生ポインタと同じ感覚で -> が使える
}                        // b が消える → カウント = 1(本体はまだ生きている。a が握っているから)
a.reset();               // a が手放す → カウント = 0 → ここで初めて TorchModel が delete される
```

#### shared_ptr の内部構造

`shared_ptr` は概念的に**2つのポインタ**を持つ小さなオブジェクト。

```
スタック                          ヒープ
┌─────────────────┐
│ model           │
│  ┌────────────┐ │            ┌──────────────────┐
│  │ objポインタ  │─┼──────────▶│  TorchModel 本体   │
│  ├────────────┤ │            └──────────────────┘
│  │ ctrlポインタ │─┼──────┐
│  └────────────┘ │       │     ┌──────────────────┐
└─────────────────┘       └────▶│ 制御ブロック        │
                                │  strong count: 1  │  ← shared_ptr の数
                                │  weak count:   0  │  ← weak_ptr の数
                                │  デリータ(消し方)  │
                                └──────────────────┘
```

| 操作 | strong count |
|---|---|
| `make_shared` / 新規構築 | 1 |
| shared_ptr をコピー(代入・関数へ値渡し) | +1 |
| shared_ptr が破棄される / `reset()` | −1 |
| **カウントが 0 になった瞬間** | 制御ブロックのデリータが本体を `delete` |

この「0 になったら消す」を **shared_ptr のデストラクタ**が行う。だから手動 `delete` が不要でリークしない。

| 性質 | 内容 |
|---|---|
| コピー | **可能**(するたび strong count +1) |
| サイズ | ポインタ2個分(本体 + 制御ブロック) |
| 実行時コスト | 制御ブロックのヒープ確保。カウント増減は**アトミック操作**(スレッドセーフ) |
| スレッド安全性 | **カウントの増減のみ**スレッドセーフ。**指す先のオブジェクト自体**への同時アクセスは別途保護が必要 |
| 破棄 | 最後の shared_ptr が消えて strong count = 0 になった瞬間 |

### 4. 「`shared_ptr` で包んで返す」とは

`new TorchModel(...)` は生ポインタ(`TorchModel*`)= アドレスの数値を返す。所有権情報を持たない。

`make_shared<TorchModel>(...)` は次の3つをやって、**`shared_ptr` という管理オブジェクトを返す**:

1. ヒープに `TorchModel` 本体を構築する(コンストラクタ `TorchModel(graph, builder)` を呼ぶ)
2. その本体を指すポインタ + 参照カウントを持つ「制御ブロック」を用意する
3. 1 と 2 をまとめた `shared_ptr<TorchModel>` を組み立てて、それを戻り値として返す

呼び出し側は生の `TorchModel*` ではなく、「使い終わったら自動で片付く・コピーで共有できるポインタ的オブジェクト」を受け取る。これが「包んで返す」の意味。

### 5. `make_unique` / `make_shared` — 生 `new` を書かないための関数

どちらも `<memory>` にある**関数テンプレート**。`make_shared<T>(args...)` の `<T>` が「生成する型」、`(args...)` が「その型のコンストラクタに渡す引数」。

```c++
// 生 new を使う書き方(非推奨)
std::shared_ptr<TorchModel> a(new TorchModel(graph, builder));

// make_shared(推奨)
auto b = std::make_shared<TorchModel>(graph, builder);
```

`make_*` を使う理由:

| 理由 | 説明 |
|---|---|
| **例外安全** | `f(std::shared_ptr<T>(new T), g())` で `new T` の後・`shared_ptr` 構築前に `g()` が例外を投げると `new T` がリーク。`make_shared` は1つの式に閉じるのでこの穴が無い |
| **アロケーション回数** | `make_shared` は「本体」と「制御ブロック」を**1回のヒープ確保**でまとめて作る。`shared_ptr(new T)` は本体で1回・制御ブロックで1回の計2回 |
| **`new` を書かない** | コード中から生 `new` / `delete` を排除でき、所有権管理を全てスマートポインタに一元化できる |
| **記述量** | 型名を1回だけ書けばよい(`std::shared_ptr<LongTypeName>(new LongTypeName(...))` の重複が無い) |

補足: `make_shared` の弱点は「本体と制御ブロックが同じメモリ塊なので、`weak_ptr` が生きている限り**本体のメモリも解放されない**」点。巨大オブジェクト + 長命な `weak_ptr` が同居する稀なケースでは `shared_ptr(new T)` を選ぶこともある。

### 6. どう渡すか — 所有権の観点で決める(前章「引数の渡し方」と接続)

判断軸は「**渡した先がそのオブジェクトを所有するか(呼び出しが終わった後も持ち続けるか)**」。「`std::move` を書くかどうか」で決めるのではない。

| 渡した先の関係 | 渡し方 | 補足 |
|---|---|---|
| **借りるだけ**(呼び出しの間だけ使う。寿命に関与しない) | `const T&` / `T&` / `T*` ── **スマートポインタを渡さない** | 生成方法(スタック / `unique_ptr` / `shared_ptr`)と無関係。`sp` からは `*sp` / `sp.get()` で取り出す |
| **単独所有を譲る**(以後その先だけが持ち主) | `std::unique_ptr<T>` を値で受け取り `std::move` で渡す | 呼び出し元は所有権を失う(`nullptr` になる) |
| **共有所有**(呼び出し元も先も同時に持ち主) | `std::shared_ptr<T>` を値で受け取る(コピー、count +1) | 本当に複数の所有者が必要なときだけ |

```c++
void save(const IModel &model, const std::string &path);   // ← 借りるだけ。所有しない
// 呼び出し側:
auto model = std::make_shared<TorchModel>(graph, builder);
store.save(*model, "weights.pt");   // shared_ptr を外して参照で渡す
```

「`std::move` を書かずに渡す」= 普通は**借りている**だけであって、その場合の正しい形は参照/ポインタ。`shared_ptr` を選ぶ理由は「move が面倒だから」ではなく「**複数の主体が同時に所有者である必要がある**から」。

### 7. 選び方の指針

> **デフォルトは `unique_ptr`。「このオブジェクトを複数の主体が同時に所有し、最後の1人まで生かす必要がある」と言えるときだけ `shared_ptr`。**

理由:

- `unique_ptr` の方が軽く(オーバーヘッドゼロ)、**所有関係=寿命がコードから読み取りやすい**
- 「とりあえず `shared_ptr`」にすると、誰がいつ手放すのか追えなくなり、実質的にグローバル変数に近い管理不能状態に陥る
- 後から「やはり共有したい」となったら `unique_ptr` → `shared_ptr` へ変換できる(**一方向**。逆は不可)

```c++
std::unique_ptr<TorchModel> u = std::make_unique<TorchModel>(graph, builder);
std::shared_ptr<TorchModel> s = std::move(u);   // ○ 一方向の変換
```

### 8. `std::weak_ptr` — 循環参照を断つ

`shared_ptr` 同士が互いを指すと、カウントが永遠に 0 にならず両方リークする。

```c++
struct Node {
    std::shared_ptr<Node> next;
    std::shared_ptr<Node> prev;   // A→B、B→A と shared_ptr で相互参照 → 両方カウント 1 のまま
};
```

片方を `std::weak_ptr`(所有権を持たない・カウントを増やさない観測用ポインタ)にして輪を切る。使うときは `lock()` で一時的に `shared_ptr` へ昇格し、対象が生きているか確認する。

```c++
struct Node {
    std::shared_ptr<Node> next;
    std::weak_ptr<Node>   prev;   // 所有しない
};

if (auto p = node->prev.lock()) {   // 生きていれば shared_ptr、破棄済みなら nullptr
    p->doSomething();
}
```

`unique_ptr` は共有できないので、この問題自体が起きない。

### 9. 不完全型とデストラクタ(pImpl・前方宣言との関係)

前方宣言だけした型(不完全型)をスマートポインタのメンバに持つときの挙動が両者で異なる。

| | `unique_ptr<T>` | `shared_ptr<T>` |
|---|---|---|
| 破棄時に `T` の完全定義が必要か | **必要**。デストラクタが実体化される地点で `T` の全貌が見えていないとコンパイルエラー | **不要**。デリータを制御ブロックに型消去して保持するため。ただし**生成時**には完全型が必要 |

```c++
// Foo.hpp
class Impl;                       // 前方宣言(不完全型)
class Foo {
    std::unique_ptr<Impl> _impl;  // pImpl イディオム
public:
    Foo();
    ~Foo();                       // ← 宣言のみ。ヘッダで = default にすると Impl 未定義でエラー
};

// Foo.cpp
#include "Impl.hpp"               // ここで Impl の完全定義が見える
Foo::Foo()  = default;
Foo::~Foo() = default;            // .cpp 側なら OK
```

この「デストラクタを宣言だけしてヘッダに置き、`= default` は `.cpp` に書く」作法は pImpl の定番。本プロジェクトの [TorchModelTrainer.hpp](../src/training/adapters/impl/TorchModelTrainer.hpp) が `~TorchModelTrainer() override;` を宣言し [TorchModelTrainer.cpp](../src/training/adapters/impl/TorchModelTrainer.cpp) で `= default` しているのは、メンバが前方宣言型への `shared_ptr` であり厳密には必須ではないが、この作法に合わせた安全側の書き方。

### 10. 本プロジェクトでの使用例

[TrainingApp.cpp](../src/training/TrainingApp.cpp)（学習の合成層。旧 main.cpp の中身）は生成物を組み立てて注入するため `make_shared` を多用している。

```c++
auto model = std::make_shared<TorchModel>(graph, builder);      // count = 1
std::vector<at::Tensor> params = model->parameters();           // main も model を使う
auto optimizer = std::make_shared<AdamOptimizer>(params, 0.001);
auto loss = std::make_shared<CrossEntropy>();
auto trainer = std::make_shared<TorchModelTrainer>(model, loss, optimizer);
//                                                 ↑ model をコピー → count = 2
```

[TorchModelTrainer.hpp](../src/training/adapters/impl/TorchModelTrainer.hpp) が `const std::shared_ptr<IModel> _model;` としてコピーを保持するので、`main` のローカル変数 `model` と trainer の `_model` が**同じ `TorchModel` を共有**する。`main` の `model` 変数が先に消えても trainer が握っている間は本体が生き残る。

一方 [IModelStore](../src/training/application/interfaces/IModelStore.hpp) の `save(const IModel &model, ...)` はモデルを**借りるだけ**なので、スマートポインタは登場せず `const IModel&` で受ける(§6 の1行目)。

設計を突き詰めれば、`model` は最終的に `trainer` だけが使うので `unique_ptr` でムーブ注入し「所有者は trainer 1人」と明示する形も取れる。現状の `shared_ptr` は「複数の生成物を段階的に組み立てて注入する」書きやすさを優先した選択。

### 11. まとめ早見表

| やりたいこと | 手段 |
|---|---|
| 動的確保オブジェクトの所有者を1人に固定 | `std::unique_ptr<T>` + `std::make_unique<T>(...)` |
| 所有権を別の場所へ移す | `std::move(uptr)` |
| 複数の主体で同時に所有し、最後の1人まで生かす | `std::shared_ptr<T>` + `std::make_shared<T>(...)` |
| 所有せずに一時的に使うだけ | `const T&` / `T&` / `T*`(`*sp` / `sp.get()` で取り出す) |
| shared_ptr の循環参照を断つ | 片方を `std::weak_ptr` にして `lock()` で使う |
| 迷ったら | まず `unique_ptr`。後から `shared_ptr` へ変換できる |
| 生 `new` / `delete` | **書かない**(スマートポインタ実装の内部など例外的な場面のみ) |

## 抽象クラスを返す関数と `unique_ptr`(ファクトリ)

「関数の戻り値をインターフェース(抽象クラス)にしたい」場面 —— 典型的には**ファクトリ**(生成の責務を1か所に集約する関数/クラス)—— では、戻り値は値ではなく `std::unique_ptr<IBase>` になる。その理由と考え方。

### 1. 「静的な型」と「動的な型」

```c++
std::unique_ptr<ILayer> build(const LayersConfig &config);
```

| | 何 | いつ決まる |
|---|---|---|
| **静的な型(static type)** | `std::unique_ptr<ILayer>` —— シグネチャに書いた型 | **コンパイル時。固定**。変わらない |
| **動的な型(dynamic type)** | そのポインタが実際に指すオブジェクトの正体(`TorchConv2DLayer` か `TorchPoolingLayer` か…) | **実行時**。関数を呼ぶまで分からない |

「戻り値の型が実行時に決まる」とは**静的な型が変わる**という意味ではない(それは不可能)。**同じ `unique_ptr<IBase>` という箱に、実行時どの具象クラスが入るかが変わる**という意味。

### 2. なぜ値で返せないのか —— ポインタが必須の2つの理由

```c++
ILayer build(const LayersConfig &config);   // ✗ そもそもコンパイルできない
```

1. **抽象クラスはインスタンス化できない**。純粋仮想関数(`= 0`)を1つでも持つ型は、その型の値・一時オブジェクト・関数引数・戻り値を作れない。
2. **具象型ごとにサイズもレイアウトも違う**。`TorchConv2DLayer` と `TorchPoolingLayer` は `sizeof` が異なる。関数の戻り値の型は1つ・サイズも1つに決まっている必要があり、「複数の具象型のどれか」を同一サイズで表現できるのは**基底クラスへのポインタ**だけ(ポインタのサイズは指す先の型に依らず一定)。

結論: オブジェクトは**ヒープに置き、基底クラスへのポインタを返す**しかない。

### 3. なぜ `shared_ptr` ではなく `unique_ptr` か

ファクトリが返すオブジェクトは「**今作ったばかりで、まだ誰も所有していない**」。それを呼び出し側へ**単独所有のまま手渡す**(所有権の移動)だけなので、単独所有 = `unique_ptr` が正しい既定。

- 参照カウントも制御ブロックも要らない(オーバーヘッドなし)
- 呼び出し側が受け取った後、共有が必要になったら `std::shared_ptr<ILayer> sp = std::move(uptr);` で**一方向に変換できる**
- 最初から `shared_ptr` で返すと、共有が不要な呼び出し側にまでコストを押し付ける

> ファクトリの戻り値は `unique_ptr<IBase>`。共有するかどうかは**受け取った側が決める**。

### 4. 一般形

「戻り値の動的な型が実行時に決まるファクトリ」は必ずこの形になる。

```c++
std::unique_ptr<IBase> create(/* 実行時の値 */) {
    switch (/* 実行時の値 */) {                       // if / switch / std::visit / 文字列比較 など
    case A: return std::make_unique<ConcreteA>(/*...*/);
    case B: return std::make_unique<ConcreteB>(/*...*/);
    }
}
```

動的な型が確定する瞬間は、**分岐が確定して `make_unique<具象クラス>` が実行される瞬間**。「実行時の値」の正体は状況により:

- `enum`(`OptimizerType::Adam` / `SGD` …)
- 文字列(設定ファイルの `"adam"`)
- `std::variant` のアクティブな要素
- パースした設定ノード、ファイル/通信から来た型コード
- GUI の選択

いずれも「コンパイル時には確定せず、データとして与えられる」もの。

### 5. 本プロジェクトの例 —— `TorchLayerBuilder`

[TorchLayerBuilder.cpp](../src/training/infrastructure/torchFunc/TorchLayerBuilder.cpp) は `LayersConfig`(内部は `std::variant<Conv2DParams, PoolingParams, ...>`)を受け取り、`std::visit` + オーバーロードセットで分岐して具象レイヤーを生成する。

```c++
std::shared_ptr<ILayer> TorchLayerBuilder::build(const LayersConfig &config)
{
    return std::visit(
        Overloaded{
            [](const Conv2DParams &p) -> std::shared_ptr<ILayer> {
                return std::make_shared<TorchConv2DLayer>(p);   // ← ここで動的な型が確定
            },
            [](const PoolingParams &p) -> std::shared_ptr<ILayer> {
                return std::make_shared<TorchPoolingLayer>(p);
            },
            // ... BatchNorm / Linear / Activation
        },
        config.params);
}
```

`variant` が実行時に保持している型(= モデル定義でユーザーが選んだ層種)が、どの具象クラスを `make` するかを決める。コンパイル時には「この層が Conv か Pooling か」は分からない。

現状は戻り値・要素とも `shared_ptr<ILayer>` だが、**生成して呼び出し側(`TorchModel` の層リスト)へ渡すだけ**なら `unique_ptr<ILayer>` で足りる。各層を複数箇所で共有する必要が出た段階で `shared_ptr` に上げればよい(§3)。

### 6. 逆に、ファクトリが要らない場合

呼び出す場所で**具象型がコンパイル時に分かっている**なら、ファクトリもポインタも不要。値で直接作る。

```c++
TorchConv2DLayer layer(convParams);   // Conv だと確定しているならこれでよい(スタック・値)
```

ファクトリ(と `unique_ptr<IBase>` 戻り値)が必要になるのは、「生成すべき具象型がコード上で確定せず、データで与えられる」ときだけ。

### 7. 補足 —— スライシングの復習

抽象でない基底クラスでも、値で受けると危険。

```c++
class Base { public: virtual void f(); };
class Derived : public Base { int _extra; public: void f() override; };

Base makeBad() { return Derived{}; }   // Derived の _extra が切り落とされ、Base 部分だけコピーされる
Base b = makeBad();                    // b.f() は Base::f() を呼ぶ(動的束縛が効かない)
```

これが**オブジェクトスライシング**。多態を保ったまま返す/渡すには、値ではなく**ポインタか参照**が必要 —— 所有権を移すなら `unique_ptr<Base>`、借りるだけなら `Base&` / `const Base&`。

### 8. まとめ

| 状況 | 戻り値の型 |
|---|---|
| 生成すべき具象型がデータで決まる(ファクトリ) | `std::unique_ptr<IBase>` |
| 生成した多態オブジェクトを共有所有させたい | いったん `unique_ptr<IBase>` で返し、受け取り側が `shared_ptr` へ変換 |
| 具象型がコンパイル時に確定している | 具象型の**値**(スタック)。ファクトリ不要 |
| 既存の多態オブジェクトを所有を移さず返す | `IBase&` / `IBase*`(寿命は別途保証) |


## プロセス管理

プログラムの実行単位を**プロセス**とよび、プロセス内で命令を逐次的に実行する単位を**スレッド**とよぶ。

### スレッド

スレッドの基本的な特徴は以下の通りになる。

- 共有メモリ:スレッド間でメモリ空間を共有するため、データのやり取りが高速に行える。
- 並列処理:複数のスレッドを同時に実行することで、処理の高速化が可能になる。

#### スレッドの作成と管理

C++11以降では、標準ライブラリの`<thread>`を使用してスレッドを作成し、管理することができる。

```cpp
#include <iostream>
#include <thread>

void threadFunction(int id){
    std::cout << "Thread " << id << " is running." << std::endl;
}

int main() {
    std::thread t1(threadFunction, 1);
    std::thread t2(threadFunction, 2);

    t1.join(); // スレッドt1の終了を待つ
    t2.join(); // スレッドt2の終了を待つ

    return 0;
}
```

#### スレッド間の同期

スレッド間でデータを共有する際、同期が必要となる。C++11以降では、`<mutex>`を使用してミューテックスを利用することで、スレッド間の競合状態を防ぐことができる。

```cpp
#include <iostream>
#include <thread>
#include <mutex>

std::mutex mtx;
void threadFunction(int id){
    std::lock_guard<std::mutex> lock(mtx); // ミューテックスをロック
    std::cout << "Thread " << id << " is running." << std::endl;
}

int main() {
    std::thread t1(threadFunction, 1);
    std::thread t2(threadFunction, 2);

    t1.join(); // スレッドt1の終了を待つ
    t2.join(); // スレッドt2の終了を待つ

    return 0;
}