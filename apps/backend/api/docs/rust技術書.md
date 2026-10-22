# Rust 用語まとめ

[Rustのチュートリアルドキュメント](https://doc.rust-jp.rs/book-ja/title-page.html)

## 基本構文

この書ではc++の考え方を用いてRustの基本構文をまとめる。

### helloworld

```rust
fn main() {
    println!("Hello, world!");
}
```

- fn: 純粋関数の定義
- !: マクロ呼び出しの印(ない場合は関数呼び出し) マクロについては後述

### 変数宣言

```rust
let x = 5; // 不変変数
let mut y = 10; // 可変変数
```

- Rustでは、変数はデフォルトで普遍(immutable). `mut`をつけることで、可変(mutable)にできる。
- let:　変数宣言のキーワード。型推論を行うため、型定義を行わずに済む。

#### シャドーイング

シャドーイングは、既に定義した変数と同じ名前の変数を新しく宣言するときに使用される。

```rust
fn main()
{
    let x=5;
    let x = x + 1; // ここでのxは新しい変数xを作って6が代入される

    {
        let x = x+2; // ここでのxは新しい変数xを作って8が代入される
        println!("The value of x in the inner scope is: {x}");
    }
    println!("The value of x is: {x}"); // 以前のスコープは終了しているので、6が出力される
}
```

これは変数を`mut`にするのとは異なる。なぜなら、`let`キーワードを使わずにこの変数に再代入を試みた際にはコンパイルエラーが出るためである。`let`を使うことで値をちょっとした加工を行うことはできるが、その加工が終わったら不変となる。

もう一つの違いとして、上書きではなく同名の異なる変数を作るというわけなため、型を変えることもできる。

```rust
let spaces = "   ";
let spaces = spaces.len(); // 文字列型から整数型に変わる
```

#### 参照変数

```rust
let mut x= 5;
let y = &mut x; // 参照変数yはxの可変
*y += 1; // yを通してxの値を変更する
```

- `&mut x`: xの可変参照を生成する。`*y`のように参照先の値にアクセスできる。

### 定数

```rust
const  THREE_HOURS_IN_SECONDS: u32 = 60 * 60 * 3;
```

rustにおいて、定数の命名規則は全てuppersnake_caseで書くことが推奨されている。

### ライブラリ参照

```rust
use std::io; // 標準ライブラリのioモジュールを参照する
```

- `use`: 他のモジュールやライブラリを参照するキーワード。C++での`#include`に相当。

#### ioモジュールの使いかた

```rust
use std::io;

let in = io::stdin(); // stdin()はstruct
in.read_line(&mut input).expect("Failed to read line");
```

- `io::stdin()`は標準入力を扱うための構造体(struct)を返す。 **Rustにはクラスがない**

##### .expect()の説明

.read_line()は参照変数に入力を格納すると同時に、Result型を戻り値として返す。`Result`は**列挙型**であり、その列挙子は`Ok`か`Err`のどちらかである。`Ok`列挙子は処理が成功したことを示し、`Err`列挙子は処理が失敗したことを意味する。(`Err`には処理が失敗した仮定や理由についての情報が含まれている。)
また、`Result`型の値にも、他の型と同様にメソッドが定義されている。`Result`のインスタンスには`expectメソッド`があり、これを呼び出すことができる。この`Result`インスタンスが`Err`の値の場合、`expect`メソッドはプログラムをクラッシュさせ、ひきすうとして渡されたメッセージを表示する。

### データ型

Rustにおける値は全て、何らかの**データ型**であり、コンパイラがどんなデータが指定されているかをしれるため、そのデータの取り扱いも把握できるということである。2種のデータ型のサブセットがある。スカラー型と複合型である。

Rustは静的型付き言語であるため、コンパイル時には全ての変数の型が判明している必要がある。複数の方が可能な場合には、型注釈をつけなければいけない。

```rust
let guess: u32 = "42".parse().expect("Not a number!");
```

- `parse`: 文字列を数値に変換するメソッド。

上のコード中にある。`:u32`が型注釈である。可能性のある型のうち、どの型を使用したいのかを知るのに役立つ.


### スカラー型

**スカラー型**は単一の値を表す。主に4つのスカラー型がある。
1. 整数型
2. 浮動小数点型
3. ブール型
4. 文字型

#### 整数型

Rustにおける整数型をまとめた表は以下の通りとなる。

|大きさ|符号付き|符号なし|
|---|---|---|
|8-bit|i8|u8|
|16-bit|i16|u16|
|32-bit|i32|u32|
|64-bit|i64|u64|
|128-bit|i128|u128|
|arch|isize|usize|

各符号付きバリアントは、$-(2^{n-1})\text{から}$ $(2^{n-1} - 1)$ までの値を取る。ここでのnは各バリアントが使用するビット数である。例として`i8`の場合, $-(2^{8-1}) = -128$ から $2^{8-1}-1 = 127$までの値を取る。

また、`isize`と`usize`はアーキテクチャに依存する整数型であり、32ビット環境では32ビット、64ビット環境では64ビットのサイズを持つ。

#### 浮動小数点型

Rustには2種類の浮動小数点型がある。

- `f32`: 32ビットの浮動小数点型単精度浮動小数点数
- `f64`: 64ビットの浮動小数点型倍精度浮動小数点数

```rust

fn main()
{
    let x = 2.0; // f64型
    let y: f32 = 3.0; // f32型
}
```

#### ブール型

Rustにおいても、ブール型は`true`か`false`の2つの値を取る。

```rust
fn main()
{
    let t = true;
    let f: bool = false; // 型注釈をつけることもできる
}
```

#### 文字型

Rustの文字型は、`char`で表される。`char`は4バイトのUnicodeスカラー値を表す。Unicodeのスカラー値は, `U+0000`から`U+D7FF`までと、`U+E000`から`U+10FFFF`までの範囲のコードポイントを表す。つまり、Rustの文字型は、ASCII文字だけでなく、漢字や絵文字などのUnicode文字も表すことができる。

```rust
fn main()
{
    let c = 'z';
    let z: char = 'ℤ'; // 型注釈をつけることもできる
    let heart_eyed_cat = '😻';
}
```

`char`リテラルは`"`を使用する文字列リテラルに対して、`'`で指定することに注意する。


### 複合型

**復号型**を使用することで、複数の価を一つの型にまとめることができる。Rustには、以下の2種類の基本的な復号型がある。

- **タプル型**
- **配列型**

#### タプル型

様々な型の複数の価を一つの複合型にまとめ上げる汎用的な手法。長さは固定長。

```rust
fn main(){
    let tup: (i32,f64,u8) = (500,6.4,1);
}
```

タプルから個々の値を取り出すには、パターンマッチングもしくはドット記法を使用する。

値を一つも持たないタプルのことを**ユニット**と呼ぶ。

##### パターンマッチング

```rust
fn main(){
    let tup: (i32,f64,u8) = (500,6.4,1);
    let (x,y,z) = tup; // パターンマッチング
    println!("The value of y is: {y}"); 
}
```

##### ドット記法

```rust
fn main(){
    let tup: (i32,f64,u8) = (500,6.4,1);
    let five_hundred = tup.0; // ドット記法
    let six_point_four = tup.1;
    let one = tup.2;
}
```

#### 配列型

多言語と異なり、**Rustの配列は固定長であり、また、同じ型の値しか格納できない**。

```rust
fn main(){
    let a = [1,2,3,4,5]; // i32型の配列
    let months = ["January", "February", "March", "April", "May", "June", "July",
                  "August", "September", "October", "November", "December"]; // &str型の配列
}
```

配列は、ヒープよりもスタックにデータのメモリを確保したい場合、常に固定長の要素があることを確認したいときに有効。
ただ、配列は、ベクタ型ほど柔軟ではない。**ベクタ**は標準ライブラリによって提供されている配列と似たようなコレクション型で、長さが可変である。どっちを使おうか迷った場合は、ベクタを使うことを推奨される。

### 関数

`fn`キーワードによって関数を宣言することができる。
Rustにおける関数と変数の命名規則は、スネークケース(snake_case)で書くことが推奨されている。

```rust
fn main() {
    another_function(5);
}

fn another_function(x: i32){
    println!("The value of x is: {x}");
}
```

#### 戻り値

矢印(`->`)の後に型を書いて宣言する。Rustでの関数の戻り値は、関数本体ブロックの最後の式の値と同義となる。`return`キーワードで関数から早期リターンし、値を指定することもできるが、多くの関数は最後の式を暗黙的に返すことを好む。

```rust
fn five() -> i32 {
    5 // 式の最後の値が返される
}

fn main() {
    let x = five();
    println!("The value of x is: {x}");
}
```

また、`five`関数を見てもわかるように、最後の式にはセミコロンがついていないことがわかる。これは、終端を**式**にする必要があるためである。

### 文と式

Rustは、式試行言語であるため、式と文の違いを理解することが重要である。

- 文:何らかの動作をして値を返さない命令
- 式:結果値に評価される。

```rust
fn main() {
    let y = (let x = 3); // 文
}
```

このコードでは、xは文であるため値が返されず、yに代入することができない。コンパイルエラーとなる。CやC++では代入は代入値という値を返すため、x = y = 3のようなコードを書けるが、Rustではできない。

そこで以下のように記述する。
```rust
fn main() {
    let y = {
        let x = 3; // 文
        x + 1 // 式
    };
}
```

`{}`で囲まれたものは式として扱われ、`let`文の一部として、`y`に束縛される。**また、`x+1`の行には文末にセミコロンがついていないことに注意する。**式の終端にセミコロンがつくと文に変えてしまい、値を返さなくなくなってしまう。

### 制御フロー

#### if式

```rust
fn main() {
    let number = 6;
    if number > 5 {
        println!("The number is greater than five.");
    } else {
        println!("The number is five or less.");
    }
}
```

式に注意。

また、`let`文の右辺に`if`式を使うこともできる。

```rust
fn main() {
    let condition = true;
    let number = if condition { 5} else { 6 };
    println!("The value of number is: {number}");
}
```
このとき、`if`式の両方の分岐が同じ型である必要がある。もし、片方が整数型で、もう片方が文字列型だった場合、コンパイルエラーとなる。

#### ループ

Rustには3種類のループがある。
- `loop`: 無限ループ
- `while`: 条件付きループ
- `for`: コレクションの要素を順に処理するループ

##### loop

```rust
fn main() {
    let mut counter = 0;
    let result = loop {
        counter += 1;
        if counter == 10 {
            break counter * 2; // breakでループを抜けると同時に値を返すことができる
        }
    };
    println!("The result is: {result}");
}
```

### 所有権規則

- Rustの各値には、**所有権**が存在する。
- いかなる時も所有者は一つ。
- 所有者がスコープから外れたら値は破棄される。

#### 変数スコープ

`string`型を例にして、変数のスコープを説明する。

```rust
let s = String::from("hello"); // sがスコープに入る
```

stringはヒープにメモリを確保するため、コンパイル時にはサイズが不明なテキストも保持することが可能。`from`関数を使用して、文字列リテラルから`String`型を生成することが可能。

#### メモリと確保

文字列リテラルの場合、中身はコンパイル時に判明しているため、テキストは最終的なバイナリファイルに直接ハードコードされる。このため、文字列リテラルは、高速で効率的になる。けどこれだと、コンパイル時にサイズが不明だったり、プログラム実行時に合わせてサイズが可変なテキストでは使用できない。
だからこそ、ヒープに確保して、プログラム実行時にサイズが可変なテキストを保持することができる`String`型が必要になる。さらに、Rustの場合GCがあるため、`allocate`と`free`を行わなくとも、所有権のスコープを抜けると自動的にメモリが解放される。

#### ムーブとデータの相互作用

Rustでは、複数の変数が同じデータに対して様々な手法で相互作用することができる。

xをyにコピーする様子
```rust
let x:i32 =5;
let y:i32 =x;
```

このコードでは、xとyは整数値なため、スタックに積まれる。これにより、コピーが可能となっている。

次に、コピーができない型の例を示す。

```rust
let s1 = String::from("hello");
let s2 = s1; // s1の所有権がs2にム
```

このコードでは、コピーは行われない。その理由について、Stringの構造を見ながら説明する。

`String`型は以下のような部品でできている。

![](https://doc.rust-jp.rs/book-ja/img/trpl04-01.svg)

`ptr`,`len`,`capacity`の3つはスタックに保持されているが、`ptr`が指すアドレスの先にあるデータはヒープ領域に保持されている。

`s1`を`s2`に代入すると、`String`型のデータがコピーされる。つまり、スタックにある`ptr`,`len`,`capacity`の3つの部品がコピーされるということ。しかし、**ポインタが指すヒープ上のデータはコピーされない**。つまり、`s1`と`s2`は同じヒープ上のデータを指すだけということになる。

![](https://doc.rust-jp.rs/book-ja/img/trpl04-02.svg)

さて、スコープから`s1`、`s2`が同時に抜けた場合どうなるか...
A: 両方ともそれぞれのスタックの領域+**ヒープの領域**を解放しようとする。これは、**二重解放**を引き起こし、memory corruptionにつながる。

そこで、Rustでは、`let s2 = s1;`した行の後、コンパイラは`s1`が有効ではないと判断する。よって、`s1`がスコープを抜けた際に何も解放する必要がなくなる。つまり、ムーブが発生したということになる。ちなみに、この後に`s1`を使おうとすると、コンパイルエラーになる。

#### クローンによる変数とデータの相互作用

仮に、`String`型のヒープデータのdeep copyを行いたい場合は、`clone`メソッドを使用する。

```rust
let s1 = String::from("hello");
let s2 = s1.clone();
```

これだと、ヒープデータが実際にコピーされる。

#### copyトレイト

Rustには`Copy`トレイトと呼ばれる特別な注釈があり、整数のようなスタックに保持される型に対して配置することができる。型が`copy`トレイトを実装していれば、その型を持つヘンスはムーブされず、代わりにコピーが行われる。

`copy`トレイトを実装している型については、一般的にスカラー値の集合は何でも`copy`を実装することができる。逆にメモリー確保が必要だったり、何らかの形態のリソースだったりするものは`copy`トレイトを実装することができない。具体的な、`copy`トレイトを実装している型の例は以下の通り。

- 整数型
- 論理型
- 浮動小数点
- 文字型
- タプル

#### 所有権と関数

関数の引数への代入についても、先と同じように型によって、コピーやムーブが発生する。

```rust
fn main() {
    let s = String::from("hello");  // sがスコープに入る

    takes_ownership(s);             // sの値が関数にムーブされ...
                                    // ... ここではもう有効ではない

    let x = 5;                      // xがスコープに入る

    makes_copy(x);                  // xも関数にムーブされるが、
                                    // i32はCopyなので、この後にxを使っても
                                    // 大丈夫

} // ここでxがスコープを抜け、sもスコープを抜ける。ただし、sの値はムーブされているので、
  // 何も特別なことは起こらない。

fn takes_ownership(some_string: String) { // some_stringがスコープに入る。
    println!("{}", some_string);
} // ここでsome_stringがスコープを抜け、`drop`が呼ばれる。後ろ盾してたメモリが解放される。
  // 後ろ盾してたメモリが解放される。

fn makes_copy(some_integer: i32) { // some_integerがスコープに入る
    println!("{}", some_integer);
} // ここでsome_integerがスコープを抜ける。何も特別なことはない。
```

`take_ownership`関数呼び出し後に`s`を呼び出すと、コンパイルエラーが発生する。なぜかはもう分かるよね?

#### 戻り値とスコープ

戻り値の所有権は、呼び出し元が見ている変数にムーブされる。一連の流れについてまとめると、
$\text{関数の引数にムーブ} \to \text{関数のスコープを抜ける} \to \text{変数の所有権が解放される}$
これだと、何度も所有権をムーブすることになり、大変。そこで、**参照**を使う。

#### 参照と借用

Rustも他の言語と同じように、参照を用いることでスタックをそのまま使うのではなく、アドレスを渡す事が可能となる。参照先では、そのアドレスを辿ってアドレスに置かれているデータにアクセスできる。ポインタと異なる点として、参照は沿いの生存期間中(スコープ)を通して、特定の型の有効な値を指していることが保証されるという点である。

```rust
fn main() {
    let s1 = String::from("hello");

    let len = calculate_length(&s1);

    // '{}'の長さは、{}です
    println!("The length of '{}' is {}.", s1, len);
}

fn calculate_length(s: &String) -> usize {
    s.len()
}
```

C++と異なる点として、仮引数だけでなく、実際に引数として代入する際にも`&`をつける必要があるという点に注意する。
参照の動きを図示するとこうなる。

![](https://doc.rust-jp.rs/book-ja/img/trpl04-05.svg)

参照を作成することを**借用(borrowing)**と呼ぶ。Rustでは,C++と異なり、借用した変数に変更を加えることができない。

```rust
fn main() {
    let s = String::from("hello");

    change(&s);
}

fn change(some_string: &String) {
    some_string.push_str(", world");
}
```

このコードではエラーが起こる。
**参照も不変である必要がある。**

#### 可変参照

参照を可変にするにはどうすればいいか? 
A:参照先の変数を可変にすればいい。

```rust
fn main() {
    let mut s = String::from("hello");
    change(&mut s);
}

fn change(some_string: &mut String){
    some_string.push_str(", world");
}
```

関数のシグネチャや関数呼び出しの際にも`mut`をつけうことで、関数は借用する値を変更することが可能となる。(C++とは逆で、C++では不変参照にしたいものに`const`をつける。)

しかし、可変参照にも大きな制約がある。1つの変数に可変参照を2個作成することが禁止されている。

```rust
    let mut s = String::from("hello");

    let r1 = &mut s;
    let r2 = &mut s;

    println!("{}, {}", r1, r2); // これは失敗する。
```

このような制約の利点としては、コンパイラがコンパイル時にデータ競合を防ぐことができるという点にある。データ競合は、競合状態と類似していて、以下の3つの振る舞いが起きるときに発生する。

1. 2つ以上のポインタが同じデータに同時にアクセスする。
2. 少なくとも一つのポインタがデータに書き込みを行っている。
3. データへのアクセスを同期する機構が使用されていない。

これは難しい問題であるからこそ、Rustはデータ競合が起きるコードのコンパイルを拒否することで、データ競合を防いでいる。

逆に、この規則に反さないならOK
```rust
    let mut s = String::from("hello");

    let r1 = &s; // 問題なし
    let r2 = &s; // 問題なし
    let r3 = &mut s; // 大問題！

    println!("{}, {}, and {}", r1, r2, r3);
```

こんな感じに、**不変参照だけなら同時並行で呼び出しが可能。しかし、不変参照と可変参照を同時並行することはだめ。**

**また、参照のスコープはその参照変数が最後に使用される時点まで続く。**よって、以下のような、コードはコンパイルが可能。

```rust
    let mut s = String::from("hello");

    let r1 = &s; // 問題なし
    let r2 = &s; // 問題なし
    println!("{} and {}", r1, r2);
    // r1とr2はもうこれ以降使用されません

    let r3 = &mut s; // 問題なし
    println!("{}", r3);
```

コンパイラはスコープの終了より前の時点で参照が使用されていないことが判別できる。

#### 宙に浮いた参照

ポインタのある言語では、**ダングリングポインタ**を誤って生成してしまう事が多々ある。

- **ダングリングポインタ**: 他人に渡されてしまった可能性のあるポインタのことであり、その箇所へのポインタを保持している間に、メモリを解放してしまうことで発生する。

Rustでは、ダングリングポインタが発生しないことを保証してくれる。何らかのデータ参照があった場合、こんなぴらは参照がスコープを抜けるまで、データがスコープを抜けることが内容確認してくれる。

```rust
fn main() {
    let reference_to_nothing = dangle();
}

fn dangle() -> &String {
    let s = String::from("hello");

    &s
}
```

このコードのように、関数スコープを抜けることで無効となる変数の参照を渡してしまうと、値もアドレスも無効となった参照を返すこととなる。Rustでは、コンパイル時にこのようなコードを検知し、コンパイルエラーとしてくれる。

### モジュールとクレート

#### クレート

Rustソースコードを集めたもの。`cargo`を実行するのではなく、単一のソースコードファイルを渡して`rustc`を実行した場合でも、コンパイラはそのファイルをクレートとしてみなす。クレートは、モジュールを含むことができモジュールは、クレーとともにコンパイルされる他のファイル内で定義することができる。

- **バイナリクレート**: 実行可能ファイルから生成されるクレート
- **ライブラリクレート**: 他のクレートから参照されるクレート。単独で実行することができない。一般的に「クレート」と呼ばれる場合は、ライブラリクレートを指す。
- **クレートルート**: Rustコンパイラの開始地点となり、クレートのルートモジュールを作るソースファイル。
- **パッケージ**: ある機能群を提供する1つ以上のクレートのまとまり。Cargo.tomlを含むディレクトリがパッケージのルートディレクトリとなる。

#### モジュール

モジュールの宣言
```rust
mod front_of_house; // front_of_house.rsをモジュールとして宣言する
```

#### モジュールの階層と公開

```rust
mod front_of_house {
    pub mod hosting {
        fn add_to_waitlist() {}
    }
}

pub fn eat_at_restaurant() {
    // Absolute path
    // 絶対パス
    crate::front_of_house::hosting::add_to_waitlist();

    // Relative path
    // 相対パス
    front_of_house::hosting::add_to_waitlist();
}
```

このコードだと、エラーになる。なぜなら、`hosting`モジュールは`pub`で公開されているが、`add_to_waitlist`関数は公開されていないため、外部からアクセスできないため。

モジュールツリーについては、**lib.rs**にまとめるのがベストプラクティスとされている。

#### パスによるモジュールや関数へのアクセス(super, create)

モジュールや関数へのアクセスは、**パス**を使って行う。パス指定にはRust独自の**絶対パス**と**相対パス**の2種類がある。


|キーワード|意味|ファイルシステムでの類比|
|---|---|---|
|`crate`|クレートのルートから絶対的に指定する|/ (ルートディレクトリ)|
|`super`|現在のモジュールの親へ、相対的に1段上がる|../ (1つ上の階層)|
|`self`|現在のモジュール自身|./ (カレントディレクトリ)|

```rust
// lib.rs (クレートルート)
pub fn root_fn() {}

mod device_type {
    // ここは entities::device_type モジュール

    pub fn parent_fn() {}

    mod capabilities {
        // ここは entities::device_type::capabilities モジュール

        fn f() {
            super::parent_fn();   // 1段上の device_type モジュールの関数を呼ぶ(相対パス)
            crate::root_fn();     // クレートルートの関数を呼ぶ(絶対パス)
        }
    }
}
```

- `super::super`とすることで、2段上のモジュールにアクセスすることができる。


このコードの上位クレート中に、`deliver_order`関数と`back_of_house`モジュールがあるとする。`back_of_house`モジュールの中から、親モジュールであるcargoクレートの中にある`deliver_order`関数を呼び出すためには、`super::deliver_order()`と書く必要がある。

`super`は「現在のモジュールから見て一つ上の階層のモジュール」を指すキーワード。

#### self

`self`には「現在のモジュール自身」としてパスキーの機能と、メソッド引数としての機能がある。

1. 現在のモジュール自身としてパスキーの機能

`device_type`モジュール自身と、その中の型を同時にインポートしたい場合

```rust
// self を使わない場合(モジュール名を2回書く必要がある)
use device_type::DeviceType;
use device_type;

// self を使う場合(1行にまとめられる)
use device_type::{self, DeviceType};
//                ^^^^ これは device_type モジュール自身を指す
```

現在のモジュール内の要素を明示する

```rust
mod device_type {
    pub struct DeviceType;

    pub fn describe () {
        // 以下の2つの行は同じ意味
        let _d = DeviceType;
        let _d = self::DeviceType; 
    }
}
```

つまり、「今いる場所を明示したい時にだけ使う、省略可能な相対パス」と考えればOK。

2. メソッドの引数としての`self`(こっちのほうがよく使う)

Rustでは、`self`という単語を**メソッドの第一引数**として使われる。パス指定とは無関係である。

```rust
// crates/entities/src/device_type.rs (想定される定義に近い形)
pub struct DeviceType {
    name: String,
}

impl DeviceType {
    // self を「値として」受け取る → 呼び出し元の所有権を奪う(ムーブ)
    fn into_name(self) -> String {
        self.name
    }

    // &self → 読み取り専用の借用。最も多用されるパターン
    fn name(&self) -> &str {
        &self.name
    }

    // &mut self → 書き換え可能な借用
    fn set_name(&mut self, name: String) {
        self.name = name;
    }
}
```

|書き方|意味|所有権|
|---|---|---|
|`self`|所有権を奪う(そのインスタンスは以後使えなくなる)|ムーブ|
|`&self`|読み取り専用で借りる|不変借用|
|`&mut self`|書き換え可能で借りる|可変借用|

この`self`は「インスタンス自身」を指す。
逆に、メソッドを実装している構造体以外のインスタンスを渡す場合は、`self`ではなく、構造体名を使う。

```rust
struct DeviceType { name: String }
struct Capabilities { max_memory: u64 }

impl DeviceType {
    fn name(&self) -> &str {
        &self.name
    }
}

fn main() {
    let cap = Capabilities { max_memory: 1024 };
    
    DeviceType::name(&cap); 
    // エラー: expected `&DeviceType`, found `&Capabilities`
    // (mismatched types)
}
```
`self`に対して、異なる型を渡すとエラーが生じる。

##### 現在のモジュール自身としてパスキーの機能

`device_type`モジュール自身と、その中の型
```rust
// self を使わない場合(モジュール名を2回書く必要がある)
use device_type::DeviceType;
use device_type;

// self を使う場合(1行にまとめられる)
use device_type::{self, DeviceType};
//                 ^^^^ これは device_type モジュール自身を指す
```

#### derive

構造体や列挙型に対して特定のトレイトの標準的な実装を自動的に提供するための属性。

```rust
#[derive(Debug, Clone, PartialEq,Eq,Hash)]
```

- `Debug`: デバック出力を可能にするトレイト。
- `Clone`: オブジェクトをコピーするためのトレイト。
- `PartialEq/Eq`: 型の比較(等値性)のためのトレイト。
- `Hash`: ハッシュマップのキーとして使用可能にするためのトレイト。
- `Default`: `.default()`で構造体のデフォルト値を作れる。

##### Debug

`{:?}`を使って、構造体の中身をデバッグ出力することができる。

```rust
#[derive(Debug)]
struct User {
    name:string,
    age:u32,
}

fn main() {
    let user = User{name:"Alice".to_string(), age:30};
    println!("{:?}",user); // User { name: "Alice", age: 30 }
}
```

##### Clone

`clone()`メソッドを使って、構造体のコピーを作ることができる。

```rust
#[derive(Clone)]
struct User {
    name:string,
    age:u32,
}
fn main() {
    let user1 = User{name:"Alice".to_string(), age:30};
    let user2 = user1.clone(); // user1のコピーを作る
}
```

##### PartialEq/Eq

`==`演算子を使って、構造体の比較を行うことができる。

```rust
#[derive(PartialEq, Eq)]
struct User {
    name:string,
    age:u32,
}
fn main() {
    let user1 = User{name:"Alice".to_string(), age:30};
    let user2 = User{name:"Alice".to_string(), age:30};
    println("{}", user1 == user2); // true
}
```

##### PartialOrd/Ord

`<`, `>`, `<=`, `>=`演算子を使って、構造体の比較を行うことができる。ソートも可能になる。

```rust
#[derive(PartialOrd, Ord)]
struct User {
    name:string,
    age:u32,
}
fn main(){
    let mut users = vec![
        User{name:"Alice".to_string(), age:30},
        User{name:"Bob".to_string(), age:25}, 
        User{name:"Charlie".to_string(), age:35}
    ];

    users.sort(); // ageの昇順でソートされる
    println!("{:?}", users);
}
```

##### Default

初期値を自動生成できる。

```rust
#[derive(Default)]
struct User {
    name: String,
    age: u32,
}

fn main() {
    let user = User::default(); // User { name: "", age: 0 }
    println!("{:?}", user);
}
```

### 内部クレート

#### future

Rustの非同期処理の基盤ライブラリ。`Future`トレイトや`Stream`トレイトなどを提供し、非同期プログラミングを可能にする。

|概念|意味|同期処理での対応物|
|---|---|---|
|`Future<Output = T>`|いつか**一回だけ**値`T`を返す非同期計算|関数の戻り値`T`|
|`Stream<Item = T>`|いつか**複数回**値`T`を返す非同期計算|イテレータの要素`T`|

##### futures-core

トレイトの定義のみ提供するクレート。
- `Stream`トレイトなど、最小限のトレイト定義だけを持つ、とても軽量なクレート。
- 使い道:「関数が`Stream`を返す」というインターフェースを書く。

##### future-util

便利なメソッドの実装を提供するクレート。

- `StreamExt`トレイトを提供する。`.next().await`、`.map()`、`.filter()`、`.collect()`などStreamを実際に消費、加工するための道具
- `Iteraotr`に対する`map`や`Collect`に相当するもの。

### 外部クレート

#### tokio

Rustの`async`や`await`を実際に動かすための非同期ランタイム。Rust本体と標準クレートに搭載されているのは、`async fn`と`Future`という「非同期処理の書き方」のみ。実行機能はない。tokioはスケジューラを担う。

##### 機能

|機能|例|用途|
|---|---|---|
|ランタイム起動|`#[tokio::main]`|`main`をasyncにする|
|テスト|`#[tokio:test]`|asyncなテスト関数を書く|
|タスク生成|`tokio::spawn(async {...})`|軽量な並行タスクを起動する|
|時間|`tokio::time::sleep`,`timeout`|非同期の待機やタイムアウト|
|同期|`tokio::sync::{Mutex,mpsc,broadcast}`|タスク間の通信やロック|
|I/O|`tokio::net::TcpListener`|ブロックしないネットワークI/O|

## Cargo

Rustのプロジェクト管理ツール。クレートの作成、依存関係の管理、ビルド、テストなどを担当する。

### Cargo.toml

Cargo.tomlはTOML(Tom's Obvious, Minimal Language)形式で書かれた設定ファイルで、Rustのビルドツール兼パッケージマネージャとなる。`[package]`はTOMLの「テーブル」と呼ばれる構文単位で、其のクレート(Rustにおけるコンパイル単位・配布単位)自体メタデータを記述する場所。これに対し、`[dependencies]`は依存関係、`[workspace]`は複数クレートの束ね方といった、別の関心事を表すテーブルである。

#### `[package]`

##### 必須フィールド

```toml
[package]
name = "hello_cargo" # クレート名
version = "0.1.0" # クレートのバージョン
edition = "2021" # Rustのエディション
```

|フィールド|意味|原理・理由|
|---|---|---|
|`name`|クレート名|crates.ioなどのレジストリで一意な識別子としてつかわれる。ハイフンはアンダースコアと同一視される。|
|`version`|クレートのバージョン番号|SemVer `MAJOR.MINOR.PATCH`に従う。依存関係の互換性判定にCargoがこの規約を利用するため、自由な文字列ではなく規約への準拠が要求される。|
|`edition`|言語エディション|`2015`, `2018`, `2021`,`2024`のいずれか。Rustは後方互換性を保ったまま言語仕様を進化させるため、エディションという単位でコンパイラの解釈モードを切り替える仕組みを採用している|

##### バージョン番号の付け方

※
MAJOR,MINOR,PATCH
|桁|上げる条件|具体例|
|---|---|---|
|MAJOR|後方互換性を破壊する変更|公開関数の引数を変更・削除、構造体フィールドの型変更|
|MINOR|後方互換性を保った機能追加|新しい公開関数やモジュールの追加|
|PATCH|後方互換性を保ったバグ修正|ロジックの内部修正、ドキュメント修正|

1. 開発初期・API未確定 → 0.1.0 のまま固定し、内部的な変更は気にせず進める(社内利用クレートで publish = false ならこの状態を長く維持しても実害はない)。
2. 最初の安定版を公開する時 → 1.0.0 に上げる。「これ以降は互換性を守る」という利用者への約束がここから始まる。
3. 以降は上表の基準に従って機械的に判断する。

##### 任意フィールド

```toml
[package]
name = "entities" 
version = "0.1.0"
edition = "2021"
description = "ドメインエンティティを定義するクレート"
license = "MIT"
authors = ["dago <d_goo-tech@outlook.jp>"]
repository = "https://github.com/..."
readme = "README.md"
publish = false          # crates.io への公開を禁止する
default-run = "api"       # 複数バイナリがある場合のデフォルト実行対象
```

##### 「プロジェクト」と「クレート」の階層関係

```
/workspaces/apps/backend/api/          ← ワークスペース(=プロジェクト全体)
├─ Cargo.toml                          ← [workspace] 定義
│
└─ crates/
   ├─ entities/                        ← 1つのクレート(ライブラリ)
   │   ├─ Cargo.toml                   ← [package] name = "entities"
   │   └─ src/
   │       ├─ lib.rs                   ← クレートのエントリーポイント
   │       └─ device_type.rs           ← lib.rs 配下のモジュール
   │
   └─ adapters/                        ← 1つのクレート(ライブラリ)
       ├─ Cargo.toml                   ← [package] name = "adapters"
       ├─ build.rs                     ← ビルド時に実行される特殊スクリプト
       └─ src/
           ├─ lib.rs                   ← クレートのエントリーポイント
           ├─ error.rs                 ← lib.rs 配下のモジュール
           └─ try_from.rs              ← lib.rs 配下のモジュール
```

- ワークスペースは複数のクレートを束ねる、Cargoレベルの概念で、プロジェクトのルートのtomlで`[workspace]`を宣言することで定義される。
- クレートはワークスペースの中の1つの構成要素であり、それぞれが独立した`[package]`セクション(=独立したコンパイル単位)を持つ。
- `lib.rs`で「クレートに属する全モジュールを`rustc`

### Cargo.tomlの生成方法

Cargo.tomlは種類によって、コマンドで自動生成するものと手動で作成するものに分かれる。

|ファイル|作り方|
|---|---|
|ワークスペースのルートの`Cargo.toml`|**手動**で作成する(生成するコマンドはない)|
|各クレートの`Cargo.toml`|`cargo new` / `cargo init`で**自動生成**する|
|依存関係(`[dependencies]`など)の追記|`cargo add`で自動追記する(手で書いても同じ)|
|`Cargo.lock`|ビルド時に完全自動生成される(手で触らない)|

#### 1. ワークスペースのルートを手動で作成

`/workspaces/apps/backend/api/Cargo.toml`を作成し、以下を記述する。

```toml
[workspace]
resolver = "2"
members = ["crates/*"] # crates/ 以下のディレクトリをすべてメンバーにする
```

先にルートを作っておくと、この後の`cargo new` / `cargo init`がワークスペースのメンバーとして認識してくれる。`members = ["crates/*"]`としておけば、クレートを増やすたびにルートを書き換える必要はない。

#### 2. クレートを生成

```bash
cd /workspaces/apps/backend/api

# ディレクトリがまだ無い場合: ディレクトリごと新規作成
cargo new --lib crates/usecases   # ライブラリクレート(src/lib.rs)
cargo new --bin crates/server     # バイナリクレート(src/main.rs)

# ディレクトリ(src/*.rs)が既にある場合: 既存ファイルを残したまま Cargo.toml と lib.rs を追加
cargo init --lib crates/entities
```

- `--lib`: ライブラリクレートとして`src/lib.rs`を生成する。他のクレートから参照される部品(`entities`, `adapters`など)に使う。
- `--bin`: バイナリクレートとして`src/main.rs`を生成する(省略時のデフォルト)。`main`関数を持つ実行ファイルに使う。
- 生成された`lib.rs`には`add`関数のサンプルが入っているので、`mod ○○;`や`pub use`に書き換える。
- `lib.rs`で`mod`宣言していないファイルはコンパイル対象にならず、rust-analyzerも解析しない。
- ファイル名はsnake_case(`get_capabilities.rs`)にする。PascalCaseにすると`mod`宣言で警告が出る。

#### 3. 依存関係を追加

```bash
# 外部クレート(crates.io)を追加 → [dependencies]
cargo add thiserror -p entities
cargo add tonic tonic-prost prost -p adapters

# ワークスペース内の別クレートを追加 → [dependencies] に path 指定で入る
cargo add entities --path crates/entities -p adapters

# ビルド時(build.rs)だけ使うクレート → [build-dependencies]
cargo add tonic-prost-build --build -p adapters

# テストだけで使うクレート → [dev-dependencies]
cargo add tokio --dev -p usecases

# feature を指定して追加
cargo add tokio --features macros,rt-multi-thread -p server

# 依存を削除
cargo remove proto -p adapters
```

|オプション|意味|
|---|---|
|`-p <クレート名>`|どのクレートの`Cargo.toml`に追記するか。ワークスペースのルートで実行するときに必要|
|`--path <パス>`|crates.ioではなく、ローカルのクレートを依存に追加する|
|`--build`|`[build-dependencies]`に追加する。`build.rs`からだけ使える|
|`--dev`|`[dev-dependencies]`に追加する。テストからだけ使える|
|`--features <名前>`|クレートのオプション機能を有効にする|

`cargo add`は、実行時点でRustのバージョンに合う最新版を`Cargo.toml`に書き込み、`Cargo.lock`も更新する。

### Cargoを使用したクレートの追加

例えば、`rand`クレートを使用する場合。まず、Cargo.tomlに以下のように記述する。

```toml
[dependencies]
rand = "0.8.5"
```

- `[dependencies]`: プロジェクトが依存する外部クレートと必要とするバージョンをCargoに伝える。　
- Cargoは**SemVer**を理解しているため、0.8.5という記載は実際には^0.8.5と同義であり、0.8.xの最新バージョンを自動的に取得する。という意味で理解している。この仕様により、バージョン0.8.5と互換性のある公開APIを持つものであれば、0.8.5より新しいバージョンがリリースされても、Cargoは自動的に最新のものを取得する。

### Cargo.lock

Cargoは自分や他の人がコードをビルドするたびに、同じ生成物をリビルドできるようにする仕組みを備えている。Cargoは何も指示されない限り、指定したバージョンの依存のみを仕様する。例えば、`rand`クレートのバージョン0.8.6がリリースされた際に、これが自分のコードのを破壊するリグレッションを含んでいるとする。これに対応するため、Rustは`cargo build`を最初に実行したときに、`Cargo.lock`ファイルを作成する。

プロジェクトを初めてビルドするとき、Cargoは条件に合うすべての依存関係のバージョンを計算し`Cargo.lock`ファイルに書き込む。 次にプロジェクトをビルドすると、CargoはCargo.lockファイルが存在することを確認し、バージョンを把握するすべての作業を再び行う代わりに、そこで指定されているバージョンを使う。 これにより再現性のあるビルドを自動的に行える。 言い換えれば、Cargo.lockファイルのおかげで、明示的にアップグレードするまで、プロジェクトは0.8.5を使い続ける。 Cargo.lockファイルは再現性のあるビルドのために重要なので、プロジェクトの残りのコードとともにソース管理にチェックインされることが多い。

#### クレートを更新して新バージョンを取得

クレートを本当に更新したくなった時、Cargoは`cargo update`コマンドを提供している。このコマンドは`cargo.lock`ファイルを無視して、`cargo.toml`ファイル内の全ての指定に適合する最新バージョンを算出する。成功したらCargoはそれらのバージョンを`cargo.lock`ファイルに記録する。ただ、Cargoはデフォルトで**0.8.5以上、0.9.0未満**の最新バージョンを取得する。もし、0.9.0がリリースされていた場合、Cargoはそれを取得しない。これは、SemVerの仕様に従っているためである。

0.9.0を取得したい場合は、Cargo.tomlの`rand`のバージョン指定を0.9.0に変更する必要がある。

### ビルド・チェック・テストのコマンド

コマンドはワークスペースのルート(`/workspaces/apps/backend/api`)で実行する。`-p`を付けないとワークスペース全体が対象になる。

|コマンド|何をするか|実行ファイルを作るか|
|---|---|---|
|`cargo check`|型エラー・借用エラーなどのコンパイルチェックだけを行う|作らない(速い)|
|`cargo clippy`|`check`に加えて、Rustらしくない書き方や非効率な書き方を警告する(lint)|作らない|
|`cargo build`|コンパイルして実行ファイル・ライブラリを作る|作る|
|`cargo run`|`build`してからバイナリクレートを実行する|作る|
|`cargo test`|テスト用にビルドして`#[test]` / `#[tokio::test]`を実行する|テスト用を作る|
|`cargo fmt`|rustfmtでコードを整形する|―|
|`cargo clean`|`target/`を丸ごと削除する|―|

#### check / clippy

```bash
cargo check                              # 最速のコンパイルチェック
cargo clippy --workspace --all-targets   # 全クレートの本体 + テストコードまで lint する
cargo clippy --fix --lib -p entities --tests   # clippy の提案を自動で適用する
```

- `--all-targets`: 本体(lib/bin)だけでなく、テストコード(`#[cfg(test)]`)もチェック対象にする。付けないとテストの中の警告は出ない。
- devcontainerの設定(`"rust-analyzer.check.command": "clippy"`)により、VS Codeはファイル保存のたびに裏でclippyを実行している。エディタ上の赤線・黄線はこの結果。

#### build / run

```bash
cargo build                   # 開発用ビルド(最適化なし・デバッグ情報あり)→ target/debug/
cargo build --release         # 本番用ビルド(最適化あり・ビルドは遅いが実行は速い)→ target/release/
cargo build -p adapters       # 指定したクレート(と、その依存)だけビルドする

cargo run -p server           # バイナリクレート server をビルドして実行する
cargo run -p server -- --port 8080   # -- の後ろはプログラム自身への引数になる
```

- ビルドの成果物はワークスペースのルートの`target/`にまとめて出力される(`.gitignore`で除外済み)。
- `build.rs`があるクレート(`adapters`)は、本体より先に`build.rs`が実行される。`.proto`を変更すると次のビルドで`pb`のコードが自動で再生成される。生成物は`target/debug/build/adapters-xxxx/out/`に置かれる。

#### test

```bash
cargo test --workspace                     # 全クレートのテストを実行
cargo test -p adapters                     # adapters のテストだけ実行
cargo test -p adapters deviceinfo          # テスト名に "deviceinfo" を含むものだけ実行
cargo test -p entities -- --nocapture      # 成功したテストの println! も表示する
```

- `cargo test <文字列>`: テスト名(`モジュール名::関数名`)の部分一致で絞り込む。
- `--`の後ろはテストランナーへのオプション。`--nocapture`を付けないと、成功したテストの標準出力は表示されない。
- VS Codeでは`#[test]`の上に出る **▶ Run Test** からも実行できる(rust-analyzerの機能)。

#### fmt

```bash
cargo fmt            # ワークスペース全体を整形する
cargo fmt --check    # 整形はせず、差分があるかだけを確認する(CI向け)
```

- 保存時の自動整形(`formatOnSave`)は開いて保存したファイルにしか効かないため、まとめて整形したいときは`cargo fmt`を使う。

#### コミット前の確認

```bash
cargo fmt --check && cargo clippy --workspace --all-targets && cargo test --workspace
```

`&&`でつなぐと、前のコマンドが失敗した時点で止まる。3つとも通ればコミットしてよい状態。

## トレイト(Trait)

**定義**: トレイトは「型が持つべき振る舞い(メソッド群)」を定義する仕組み。他言語のインターフェース(Java)やプロトコル(Swift)に相当する概念で、「この型は何ができるか」を宣言する。

様々なクレートの内部にはトレイトが定義されており、トレイトを実装することで、クレートの機能を利用できるようになる。例えば、`std::fmt::Display`トレイトを実装することで、`println!`マクロでその型の値を表示できるようになったり、`rand::Rng`トレイトを実装することで、乱数生成器が実装すべきメソッドを使用することができる。

```rust
trait Animal {
    fn speak(&self) -> String;
}

struct Dog;
impl Animal for Dog {
    fn speak(&self) -> String { "Woof".to_string() }
}
```

**原理的な位置づけ**: Rustはクラス継承を持たず、代わりに「構造体(データ)」と「トレイト(振る舞い)」を分離するコンポジション指向の設計思想を採っている。これはGoFの原則「継承より合成(composition over inheritance)」をより厳格に言語レベルで強制したものといえる。

トレイトには2つの使い方がある。

- 静的な制約として使う(ジェネリクスの境界)
- 動的な型として使う(`dyn Animal` = トレイトオブジェクト)

## ジェネリクス(Generics)

**定義**: 具体的な型を指定せず、型をパラメータ化してコードを書く仕組み。

```rust
fn print_speak<T: Animal>(animal: &T) {
    println!("{}", animal.speak());
}
```

`<T: Animal>`は「Tは何らかの具体型だが、Animalトレイトを実装している型に限る」という**トレイト境界(trait bound)**である。これにより「Animalの機能を使う」というコンパイル時の契約と、「具体的にどの型が来るか」という決定を分離できる。これは依存性逆転の原則(DIP: Dependency Inversion Principle)をRustで実現する主要な機構であり、呼び出し側の関数は具体的な`Dog`や`Cat`を知らず、`Animal`という抽象にのみ依存する。

**なぜ必要か**: ジェネリクスがなければ、型ごとに同じロジックを書く(コード重複)か、実行時に型情報を確認する(型安全性の低下)しかない。ジェネリクスはコード重複を避けつつ、コンパイル時に型安全性を保証する。

## 静的ディスパッチ(Static Dispatch)

**定義**: 「どの実装(メソッド本体)を呼び出すか」をコンパイル時に確定させる仕組み。対義語は動的ディスパッチ(dynamic dispatch)で、こちらは実行時にvtable(仮想関数テーブル)経由で呼び出し先を決定する。

**メカニズム**: ジェネリクス関数`print_speak<T: Animal>`は、コンパイル時に実際に使われる型ごとに**単相化(monomorphization)**される。つまり`print_speak::<Dog>`と`print_speak::<Cat>`という別々の関数が生成され、それぞれの中で`Dog::speak`や`Cat::speak`が直接呼び出される。

```
// ソースコード
print_speak::<Dog>(&dog);

// コンパイラが内部的に生成するイメージ
fn print_speak_Dog(animal: &Dog) {
    println!("{}", Dog::speak(animal)); // 直接呼び出し、間接参照なし
}
```

一方、`dyn Animal`(トレイトオブジェクト)を使う動的ディスパッチでは、実行時にvtableを介して関数ポインタを引いてから呼び出すため、わずかなオーバーヘッドと、インライン化されにくいという最適化上の制約が生じる。

**トレードオフ**:

| 観点 | 静的ディスパッチ(ジェネリクス) | 動的ディスパッチ(`dyn Trait`) |
|---|---|---|
| 実行速度 | 速い(インライン化可能、ゼロコスト) | わずかに遅い(vtable経由) |
| バイナリサイズ | 型の数だけコード生成されるため増加 | 単一の実装のみでコンパクト |
| 柔軟性 | 型はコンパイル時に確定が必要 | 実行時に異なる型を混在させたコレクションなどが可能 |

これが「Rustのゼロコスト抽象化」という思想の具体的な中身である。抽象化(トレイトによる契約)を導入しても、静的ディスパッチを選ぶ限り、手書きで型ごとに書いたコードと同等の実行効率が得られる、という設計原理である。クリーンアーキテクチャの文脈で言えば、「DIPによる抽象化」と「パフォーマンス」を両立させたい場合に、`dyn Trait`ではなくジェネリクス+トレイト境界を選ぶ理由がここにある。

## 標準ライブラリ

### assert

`assert!`(および`assert_eq!`, `assert_ne!`)は、テストやデバッグのために条件を検証するマクロである。条件が偽の場合、プログラムはパニックを起こし、スタックトレースとともに終了する。

- `assert!(条件)`: 条件が`false`なら`assertion failed: 条件式`というメッセージでパニック。
- `assert_eq!(左辺, 右辺)`: 左辺と右辺が等しくない場合、`assertion failed: 左辺 == 右辺`というメッージでパニック。
- `assert_ne!(左辺, 右辺)`: 左辺と右辺が等しい場合、`assertion failed: 左辺 != 右辺`というメッセージでパニック。
