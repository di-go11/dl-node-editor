# CMake技術書 — モダンCMakeにおけるモジュール(ターゲット)関係の記法

対象読者: C++のビルドをある程度手で(g++ 直叩き等で)やったことはあるが、CMakeの「ターゲット」「PUBLIC/PRIVATE/INTERFACE」「find_package」まわりの意味論を体系的には理解していない人。

本書は本プロジェクト([CMakeLists.txt](../CMakeLists.txt))を教材として使い、抽象的な文法だけでなく「なぜこの記法が採用されているか」を実例とセットで説明する。

---

## 1. CMakeとは何か — ビルドシステムジェネレータという位置づけ

### 1.1 定義

CMakeは **ビルドシステムジェネレータ(build system generator)** である。CMake自身はコンパイラを呼び出さない。`CMakeLists.txt` に書かれた宣言的な記述を読み取り、Make・Ninja・Visual Studioプロジェクトなど、プラットフォームごとの実際のビルドシステムファイルを **生成** するのが仕事である。

```
CMakeLists.txt (入力)
      │  cmake 実行(構成: configure)
      ▼
build/Makefile や build.ninja (生成物)
      │  make / ninja 実行(ビルド: build)
      ▼
実行ファイル・ライブラリ
```

この二段階(configure → build)は本書全体を通じて重要な前提になる。`find_package` や `pkg_check_modules` はconfigure時に評価され、その結果に基づいて生成されるビルドファイルが決まる。「なぜCMakeCacheに値を焼き込む必要があるのか」(後述4.4節)もこの二段階構造に由来する。

### 1.2 なぜ「モダンCMake」という言葉があるのか

CMake 2.x〜3.0以前は、`include_directories()` や `link_libraries()` のように **ディレクトリ全体に対してグローバルに** 効くコマンドが中心だった。これはA・Bという2つのライブラリが同じディレクトリ内にあると、意図せず互いの依存関係が漏れ出す(leakする)という問題を持つ。

CMake 3.0以降で主流になった書き方は、依存関係を「ディレクトリ」ではなく「ターゲット」に紐づける。これを本書では一貫して **ターゲットベースCMake(モダンCMake)** と呼ぶ。本プロジェクトのCMakeLists.txtも全面的にこのスタイルで書かれている([target_include_directories](../CMakeLists.txt#L74)、[target_link_libraries](../CMakeLists.txt#L82)等)。

原理: **ターゲットは依存関係グラフのノードである。** ターゲット間の関係(モジュール関係)を正しく記述すれば、CMakeが依存の伝播(propagation)を自動で計算してくれる。逆に言えば、モダンCMakeを使う理由の大部分は「手で依存を伝播させるコードを書かなくて済む」という一点に尽きる。

---

## 2. ターゲット(Target) — モジュール関係の最小単位

### 2.1 ターゲットとは

ターゲットとは、CMakeが管理する「ビルド可能な成果物、またはそれに準ずるもの」である。代表的な生成コマンド:

| コマンド | 生成されるターゲットの種類 |
|---|---|
| `add_executable(name ...)` | 実行可能ファイル |
| `add_library(name STATIC/SHARED/OBJECT ...)` | 静的/共有/オブジェクトライブラリ |
| `add_library(name INTERFACE)` | 実体を持たない「要件だけ」のライブラリ(2.5節) |
| `add_custom_target(name ...)` | 実行ファイルを生成しない疑似ターゲット |

本プロジェクトの例([CMakeLists.txt:69-71](../CMakeLists.txt#L69-L71)):

```cmake
add_library(ai_engine_lib
	${ALL_SRCS}
)
```

これで `ai_engine_lib` という名前のターゲットが1つ定義される。以後、このターゲットに対して「どこを includeパスに含めるか」「何をリンクするか」を **後から追加で** 指定していく。これがモダンCMakeの基本パターンであり、次節以降で見る `target_*` 系コマンドはすべて「あるターゲットに情報を追加する」という形をしている。

### 2.2 可視性キーワード PUBLIC / PRIVATE / INTERFACE — モジュール関係の核心

`target_*` 系コマンドには必ず可視性(visibility)キーワードを指定する。これがモジュール間の依存伝播ルールを決める、本書で最も重要な概念である。

ターゲットが持つ性質(includeパス、リンクするライブラリ、コンパイル定義など)には2つの側面がある。

1. **自分をビルドするために必要か**(自分自身のコンパイル・リンクで使う)
2. **自分を使う側(リンクする側)にも必要か**(自分のヘッダーが利用者にも見える依存を要求するか)

この2つの軸の組み合わせが PUBLIC / PRIVATE / INTERFACE である。

| キーワード | 自分に効く | 使う側に伝播する | 典型的な用途 |
|---|:---:|:---:|---|
| `PRIVATE` | ○ | × | 実装の詳細(.cppの中でしか使わないヘッダー・ライブラリ) |
| `INTERFACE` | × | ○ | 自分は使わないが、利用者には要求する(ヘッダーオンリーライブラリなど) |
| `PUBLIC` | ○ | ○ | 自分の公開ヘッダー(.hpp)が要求する依存 |

図で表すと以下のようになる。

```
targetA --PRIVATE--> Dep1   (Dep1 は targetA の内部にのみ関係。A をリンクしても Dep1 は見えない)
targetA --PUBLIC --> Dep2   (Dep2 は targetA にも、A をリンクした targetB にも伝播)
targetA --INTERFACE-> Dep3  (Dep3 は targetA 自体は不要だが、A をリンクした targetB には必要)

targetB --link--> targetA
  └─ 実際に targetB が使えるのは: Dep2, Dep3 (PUBLIC/INTERFACEのみ伝播)
```

#### 具体例: なぜ `ai_engine_lib` は torch を PRIVATE でリンクしているか

([CMakeLists.txt:82](../CMakeLists.txt#L82))

```cmake
target_link_libraries(ai_engine_lib PRIVATE "${TORCH_LIBRARIES}" ${OpenCV_LIBS})
```

これは「`ai_engine_lib` は自分のビルドにlibtorch/OpenCVを使うが、`ai_engine_lib` をリンクする側(利用者)には libtorch/OpenCV を **押し付けない**」という意思表示である。

ところが本プロジェクトの[CMakeLists.txt:124-142](../CMakeLists.txt#L124-L142)のコメントが示す通り、CMakeの仕様上「STATICライブラリのPRIVATE依存の使用要件(includeディレクトリ等)は、それをリンクする最終成果物にも伝播してしまう」という既知の制約がある。これはPUBLIC/PRIVATE/INTERFACEの原則(PRIVATEは伝播しない)の **例外** であり、原則から外れる実装をせざるを得ない箇所として明示的にコメントで理由づけされている。この制約のために、`ai_engine_grpc` は `ai_engine_lib` に直接リンクせず、実行ファイル `ai_engine_app` の段階で初めて両方をリンクするという設計(DIによる疎結合)を取っている。

> 学習ポイント: PUBLIC/PRIVATE/INTERFACEは「あるべき依存の方向」を宣言する仕組みであり、クリーンアーキテクチャの「依存性の方向」の原則をビルドシステムのレベルで表現する手段でもある。本プロジェクトで「gRPCアダプタ層(`ai_engine_grpc`)がlibtorch実装(`ai_engine_lib`)に直接リンクしない」設計は、CMakeのビルド上の制約であると同時に、[ICapabilityProviderという抽象への依存だけを許し、具象実装は合成層(GrpcApp)がDIで注入する](../CMakeLists.txt#L124-L142)というクリーンアーキテクチャの実践そのものである。

### 2.3 `target_include_directories` — ヘッダー探索パスのモジュール化

```cmake
target_include_directories(<target> <PUBLIC|PRIVATE|INTERFACE> <path>...)
```

本プロジェクトの例([CMakeLists.txt:73-81](../CMakeLists.txt#L73-L81)):

```cmake
target_include_directories(ai_engine_lib PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)

target_include_directories(ai_engine_lib PRIVATE
	${CMAKE_CURRENT_SOURCE_DIR}
	${TORCH_INCLUDE_DIRS}
	${OpenCV_INCLUDE_DIRS}
)
```

同じターゲットに対して `target_include_directories` を複数回呼んでよい。CMakeは呼び出しごとの指定を **累積** する(上書きではない)。これは「基本のsrc/」「後から必要になった外部ライブラリのパス」のように、関心事ごとに呼び出しを分けて書けることを意味する。

古い書き方(非推奨)との対比:

```cmake
# 旧式: ディレクトリ全体に効く。同じCMakeLists.txt内の全ターゲットに漏れる
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/src)

# モダン: このターゲットにしか効かない
target_include_directories(ai_engine_lib PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
```

### 2.4 `target_link_libraries` — リンク関係とプロパティ伝播の両方を担う

`target_link_libraries` は名前から「リンクの指定」に見えるが、モダンCMakeでは **依存グラフの辺(エッジ)を張るコマンド** という理解の方が正確である。リンクされるライブラリがCMakeターゲットである場合、リンクだけでなく、そのターゲットが `PUBLIC`/`INTERFACE` で持つ include パスやコンパイル定義も同時に伝播される。

例([CMakeLists.txt:149-150](../CMakeLists.txt#L149-L150)):

```cmake
target_link_libraries(ai_engine_grpc PRIVATE
	ai_engine_proto)
```

`ai_engine_proto` は[95行目](../CMakeLists.txt#L95)で `target_link_libraries(ai_engine_proto PUBLIC gRPC::grpc++ SystemProtobuf::libprotobuf)` と定義されているため、`ai_engine_grpc` は `ai_engine_proto` をリンクするだけで、gRPC/protobufのinclude pathやリンクライブラリを **自動的に** 受け取る。これがモジュール関係を明示することの実利であり、もし旧式のグローバルコマンドで書いていた場合、依存が増えるたびに全ターゲットへの指定を手で書き足す必要があった。

### 2.5 INTERFACE ライブラリ — 実体を持たない依存の束

`add_library(name INTERFACE)` は、コンパイルされる実体を持たない「要件の集合」だけのターゲットを作る。ヘッダーオンリーライブラリや、「複数のPUBLICオプションをまとめた設定セット」を表現するのに使う。

```cmake
# 例: プロジェクト共通のコンパイルオプションをまとめるINTERFACEターゲット
add_library(project_warnings INTERFACE)
target_compile_options(project_warnings INTERFACE -Wall -Wextra)

# 各実行ファイル/ライブラリはこれをリンクするだけで警告オプションを受け取る
target_link_libraries(ai_engine_lib PRIVATE project_warnings)
```

本プロジェクトでは直接使われていないが、「型としては実体がないのに `target_link_libraries` の対象になれる」という点が、次節のALIAS/IMPORTEDターゲットの理解につながる。

---

## 3. 外部依存の取り込み — `find_package` とターゲットのインポート

### 3.1 `find_package` の2つのモード

`find_package(<Name> ...)` には大きく2つの動作モードがある。

1. **Module モード**: CMake自身、またはプロジェクトが `Find<Name>.cmake` というスクリプトを持っていて、それを実行して依存を探す。見つけたパス等を `<Name>_INCLUDE_DIRS` のような変数にセットする(古いスタイル)か、ターゲットを定義する(新しいFindモジュールの場合)。
2. **Config モード**: 依存ライブラリ自身が `<Name>Config.cmake` (または `<name>-config.cmake`) を配布しており、それを直接読み込む。多くの場合、ターゲット(例: `Torch::Torch` ではなく本プロジェクトでは変数 `TORCH_LIBRARIES` 形式)を提供する。

本プロジェクトの例([CMakeLists.txt:13](../CMakeLists.txt#L13), [16](../CMakeLists.txt#L16), [43](../CMakeLists.txt#L43)):

```cmake
find_package(Torch REQUIRED)      # Torch は Config モード(TorchConfig.cmake)
find_package(OpenCV REQUIRED)     # OpenCV も Config モード
find_package(Protobuf REQUIRED)   # Protobuf は Module モード(FindProtobuf.cmake)
```

`REQUIRED` を付けると、見つからなかった場合にconfigure自体をエラーで停止させる。付けない場合は `<Name>_FOUND` 変数で見つかったかどうかを分岐に使える。

### 3.2 `find_package` が使えない場合の代替 — `pkg_check_modules`

configモードのファイル(`<Name>Config.cmake`)を配布していないライブラリも多い。その場合、Linuxでは `pkg-config` が提供する `.pc` ファイルから情報を取る `FindPkgConfig` モジュールを使う。

本プロジェクトの例と、その理由づけ([CMakeLists.txt:18-25](../CMakeLists.txt#L18-L25)):

```cmake
# Ubuntu 22.04 の libgrpc++-dev(apt)は gRPCConfig.cmake / gRPCTargets.cmake を
# 提供しない(pkg-config の .pc ファイルしか無い)ため find_package(gRPC CONFIG)
# は失敗する。
find_package(PkgConfig REQUIRED)
pkg_check_modules(GRPCPP REQUIRED IMPORTED_TARGET grpc++)
add_library(gRPC::grpc++ ALIAS PkgConfig::GRPCPP)
```

ここで学ぶべき原理は「ライブラリの配布形態(apt パッケージがConfigスクリプトを含むか)によって、同じ依存の取り込み方でも `find_package` と `pkg_check_modules` を使い分ける必要がある」という現実的な制約である。原則(モダンCMakeはターゲットベース)を貫くために、モジュール取得の手段そのものは環境に応じて変える、という設計判断がここに現れている。

`pkg_check_modules(<prefix> IMPORTED_TARGET <pkgconfig名>)` を呼ぶと、`PkgConfig::<prefix>` という名前のIMPORTEDターゲットが自動生成される。次節でこの「IMPORTEDターゲット」と「ALIASターゲット」を扱う。

### 3.3 IMPORTED ターゲット — 「外部で既にビルド済みのもの」をCMakeの世界に持ち込む

IMPORTEDターゲットとは、「このプロジェクトではビルドしないが、既にディスク上に存在するライブラリ/実行ファイルを、CMakeのターゲットとして扱えるようにしたもの」である。`add_library(... IMPORTED)` や `add_executable(... IMPORTED)` で作る。

本プロジェクトの例([CMakeLists.txt:27-30](../CMakeLists.txt#L27-L30)):

```cmake
find_program(GRPC_CPP_PLUGIN_EXECUTABLE grpc_cpp_plugin REQUIRED)
add_executable(gRPC::grpc_cpp_plugin IMPORTED)
set_target_properties(gRPC::grpc_cpp_plugin PROPERTIES
	IMPORTED_LOCATION ${GRPC_CPP_PLUGIN_EXECUTABLE})
```

`find_program` はシステム上の実行ファイル(ここでは `protoc` のgRPCコード生成プラグイン)のパスを探す。そのパスを `IMPORTED_LOCATION` プロパティに設定することで、以後 `gRPC::grpc_cpp_plugin` を **通常のターゲットと同じ記法** (後述の generator expression `$<TARGET_FILE:...>` など)で参照できるようになる。

原理として重要なのは、**「ビルドする対象(add_library)」と「既存の実体を参照するだけの対象(add_library ... IMPORTED)」を同じ `target_link_libraries` の記法で扱える** という点である。これによって、利用側のコード(`target_link_libraries(x PRIVATE gRPC::grpc++)`)は、相手が自プロジェクト内のターゲットなのか外部の既存バイナリなのかを意識しなくてよい。これはオブジェクト指向設計における「インターフェースに依存し、実装の違いを気にしない」考え方のビルドシステム版である。

### 3.4 ALIAS ターゲット — 名前空間付きの別名

ALIASターゲットは、既存のターゲットに **読み取り専用の別名** を与える。実体を増やさず、名前だけを追加する。

```cmake
add_library(<alias-name> ALIAS <target>)
```

本プロジェクトの例([CMakeLists.txt:25](../CMakeLists.txt#L25), [55](../CMakeLists.txt#L55)):

```cmake
add_library(gRPC::grpc++ ALIAS PkgConfig::GRPCPP)
add_library(SystemProtobuf::libprotobuf ALIAS PkgConfig::PROTOBUF)
```

なぜこの別名付けが必要なのか。理由は2つある。

1. **名前空間の慣習を合わせるため**: 正規のgRPC CMakeパッケージが提供する場合、ターゲット名は `gRPC::grpc++` である。しかし本プロジェクトでは`pkg_check_modules`経由で取得したため実体は `PkgConfig::GRPCPP` という名前になる。以降のコードが `gRPC::grpc++` という「本来あるべき名前」で書けるように別名を与えている。`::` を含むターゲット名はCMakeの慣習で「これはIMPORTEDまたはALIASターゲットであり、タイポで衝突する心配がない」ことを示す目印としても機能する。
2. **名前の衝突回避**: [CMakeLists.txt:44-55](../CMakeLists.txt#L44-L55)のコメントが詳しく説明する通り、`find_package(Torch)` が内部で `protobuf::libprotobuf` という名前のダミーターゲットを **先に** 作ってしまうため、後から `find_package(Protobuf)` を呼んでも同名のターゲットは上書きされない(CMakeの `add_library` は同名ターゲットの再定義を許さないため、ガード処理がすでに存在を検知して何もしない)。この名前を諦め、`SystemProtobuf::libprotobuf` という別名で本物のprotobufライブラリを提供している。

> 学習ポイント: ALIASは「見た目の名前の整理」だけでなく、「複数のfind_package/pkg_check_modulesの結果が同じ名前を主張して衝突する」という実務上よくある問題への回避策として使われる。これはビルドシステムにおける名前空間管理の技法であり、ソフトウェア設計における名前衝突・多重定義の問題と本質的に同じ構造を持つ。

---

## 4. プロジェクトの階層化 — `add_subdirectory` によるモジュール分割

現在の本プロジェクトの `CMakeLists.txt` は単一ファイルだが、プロジェクトが大きくなるとサブディレクトリごとに `CMakeLists.txt` を分割するのが一般的である。ここでは一般的な記法として説明する。

### 4.1 基本構文

```cmake
add_subdirectory(<source_dir> [<binary_dir>] [EXCLUDE_FROM_ALL])
```

`<source_dir>` にある `CMakeLists.txt` を読み込み、そこで定義されたターゲットを **親のCMakeLists.txtからも見える** ようにする。

例: もし本プロジェクトを次のように分割するなら、

```
ai-engine/
├── CMakeLists.txt        (トップレベル)
├── src/
│   └── CMakeLists.txt    (ai_engine_lib を定義)
└── src/api/grpc/
    └── CMakeLists.txt    (ai_engine_grpc を定義)
```

トップレベルの `CMakeLists.txt` は:

```cmake
add_subdirectory(src)
add_subdirectory(src/api/grpc)

add_executable(ai_engine_app src/main.cpp)
target_link_libraries(ai_engine_app PRIVATE ai_engine_grpc ai_engine_lib)
```

`src/CMakeLists.txt` は:

```cmake
add_library(ai_engine_lib ${ALL_SRCS})
target_include_directories(ai_engine_lib PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(ai_engine_lib PRIVATE "${TORCH_LIBRARIES}")
```

### 4.2 スコープの規則

`add_subdirectory` で読み込まれる子の `CMakeLists.txt` は、**変数については新しいスコープ** を持つ(子で定義した変数は自動では親に伝わらない。`PARENT_SCOPE` オプション付きの `set()` で明示的に返す必要がある)が、**ターゲットについてはグローバル** に見える(子で `add_library` したターゲットは、親からも兄弟ディレクトリからも `target_link_libraries` で参照できる)。

```cmake
# src/CMakeLists.txt 内
set(LOCAL_VERSION "1.0")              # このスコープ内だけで有効
set(PROJECT_VERSION "1.0" PARENT_SCOPE)  # 親のCMakeLists.txtにも伝える
add_library(ai_engine_lib ...)        # 親からも target_link_libraries(x PRIVATE ai_engine_lib) で参照可
```

この非対称性(変数はローカル、ターゲットはグローバル)こそが、`add_subdirectory` を使った物理的なファイル分割と、2章で説明したターゲットベースのモジュール関係が **両立** する理由である。ファイルをどう分割しても、ターゲット間の依存グラフ(`target_link_libraries`の関係)さえ正しく書けば、CMakeはどのディレクトリで定義されたかに関係なく依存を解決する。

### 4.3 なぜ本プロジェクトは分割していないのか(現状)

現状の規模(単一の実行ファイル+複数のテスト実行ファイル)では、`add_subdirectory` による分割は複雑さに見合わない。[CMakeLists.txt](../CMakeLists.txt)はコメント([1行目〜]から)で各ステップに番号を振り、1つのファイル内で見通しを保っている。add_subdirectoryは「ソースツリーの物理構造とビルド定義を一致させたい」「サブプロジェクトを他プロジェクトから独立して利用可能にしたい」という要求が出てきた段階で導入を検討すればよい技法である。

### 4.4 configure時の変数キャッシュとの関係

[CMakeLists.txt:40-42](../CMakeLists.txt#L40-L42)のように、`CACHE` オプション付きの `set()` は、変数をCMakeCache.txtに書き込み、configureをまたいで値を保持する。

```cmake
set(Protobuf_INCLUDE_DIR /usr/include CACHE PATH "" FORCE)
```

これは1章で述べた「configureとbuildの二段階構造」の帰結である。`find_package(Protobuf)` は内部で `Protobuf_INCLUDE_DIR` 等のキャッシュ変数を参照しながら探索する。環境変数 `CMAKE_PREFIX_PATH` はCMake起動時に一度だけ内部変数に取り込まれるため、`CMakeLists.txt` の実行途中で `unset(ENV{...})` しても手遅れである。そこで探索対象のキャッシュ変数を直接 `FORCE` 上書きし、探索そのものを意図した結果に固定している。

---

## 5. Generator Expressions — configure時ではなくgenerate時に評価される式

`$<...>` の形式で書かれるものはgenerator expressionと呼ばれ、`CMakeLists.txt` を読む(configure)段階ではなく、ビルドファイルを書き出す(generate)段階で評価される。ターゲットの実ファイルパスや、ビルド種別(Debug/Release)ごとに異なる値を埋め込みたいときに使う。

本プロジェクトの例([CMakeLists.txt:120](../CMakeLists.txt#L120)):

```cmake
PLUGIN "protoc-gen-grpc=$<TARGET_FILE:gRPC::grpc_cpp_plugin>"
```

`$<TARGET_FILE:gRPC::grpc_cpp_plugin>` は「`gRPC::grpc_cpp_plugin` というターゲット(3.3節のIMPORTEDターゲット)が指す実行ファイルの、実際のファイルパス」に展開される。これを文字列として直接書けない理由は、そのパスが `find_program` の結果に依存し、環境によって変わるからである。

他によく使う例:

```cmake
# Debug/Releaseでコンパイル定義を変える
target_compile_definitions(myapp PRIVATE
	$<$<CONFIG:Debug>:ENABLE_DEBUG_LOG>
)

# あるターゲットが静的ライブラリかどうかで分岐
$<TARGET_LINKER_FILE:mylib>
```

---

## 6. モジュール関係のまとめ表

| やりたいこと | 記法 | 依存の伝播 |
|---|---|---|
| ターゲットを定義する | `add_library` / `add_executable` | — |
| 実体のない要件だけのターゲット | `add_library(x INTERFACE)` | 定義次第 |
| 既存バイナリをターゲット化 | `add_library/add_executable(x IMPORTED)` + `set_target_properties` | — |
| ターゲットに別名を与える | `add_library(alias ALIAS target)` | 元と同一 |
| includeパスを追加 | `target_include_directories(x PUBLIC/PRIVATE/INTERFACE dir)` | キーワード次第 |
| リンク+依存伝播 | `target_link_libraries(x PUBLIC/PRIVATE/INTERFACE y)` | キーワード次第 |
| コンパイル定義を追加 | `target_compile_definitions(x PUBLIC/PRIVATE/INTERFACE DEF)` | キーワード次第 |
| リンクオプションを追加 | `target_link_options(x PUBLIC/PRIVATE/INTERFACE opt)` | キーワード次第 |
| 外部ライブラリを探す(Config優先) | `find_package(Name REQUIRED)` | ターゲットまたは変数を提供 |
| pkg-config経由で探す | `pkg_check_modules(prefix REQUIRED IMPORTED_TARGET pkg)` | `PkgConfig::prefix` ターゲットを提供 |
| サブディレクトリにビルド定義を分割 | `add_subdirectory(dir)` | ターゲットはグローバルに見える |
| generate時にしか決まらない値を埋め込む | `$<...>` (generator expression) | — |

### 学習の要点(原理の振り返り)

1. **モダンCMakeは「ターゲット」を依存グラフのノードとして扱う。** ディレクトリ全体に効く旧式コマンド(`include_directories`等)は依存が漏れるため避ける。
2. **PUBLIC/PRIVATE/INTERFACEは、クリーンアーキテクチャの「依存の方向」をビルドシステムのレベルで表現する手段である。** 本プロジェクトの `ai_engine_grpc` が `ai_engine_lib` を直接リンクしない設計は、この考え方の実例である。
3. **find_package / pkg_check_modules / IMPORTEDターゲット / ALIASターゲットは、いずれも「外部の何か」を自プロジェクトの依存グラフに統一的な形(ターゲット)で取り込むための手段** であり、取り込み方が違っても利用側のコード(`target_link_libraries`)は同じ記法で書ける。
4. **add_subdirectoryによるファイル分割と、ターゲットベースの依存関係は独立した概念である。** ファイルをどう分けるかはプロジェクトの物理構造の都合であり、依存関係グラフ(モジュール関係)の正しさとは別の関心事として設計できる。
