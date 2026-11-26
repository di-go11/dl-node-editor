# chore:C++(ai-engine)の命名規則の統一

## 問題点

ai-engine(C++)には命名規則が決まっておらず、同じ種類のものでも書き方がそろっていない。特にディレクトリ名は 5 種類の書き方が混ざっている。新しくファイルやクラスを作るたびに「どの書き方に合わせるか」を考える必要があり、include のパスも推測しにくい。

### 現状(2026-11-22 時点、`src/` と `tests/` を集計)

| 対象 | 現状 | そろっているか |
|---|---|---|
| ディレクトリ名 | 小文字1語(`adapters`, `impl`, `timer`)、camelCase(`torchFunc`, `torchModel`, `parallelProcessFn`, `readConfig`)、PascalCase(`DataSpecs`, `Metrics`, `ModelGraph`, `DAG`, `Layers`, `Optimizer`)、kebab-case(`domain-objects`)、snake_case(`lr_scheduler`)が混在 | ✕ |
| ファイル名(src) | PascalCase で、中のクラス名と同じ(`TorchModelTrainer.hpp`)。269 ファイル | ◯ |
| ファイル名(tests) | snake_case + `_test`(`model_evaluator_test.cpp`)。25 ファイル | ◯(src とは別の規則としてそろっている) |
| 型(class / struct / enum / using) | PascalCase。インターフェースは `I` 接頭辞(`IOptimizer`) | ◯ |
| 関数・メソッド | camelCase(`trainOneEpoch`, `learningRateAt`) | ◯ |
| メンバ変数 | `_camelCase`(`_optimizer`)。159 か所すべて | ◯ |
| enum の値 | PascalCase(`Adam`, `OneBatch`)が大半。`ImageAnnotationType` だけ UPPER_SNAKE(`PASCAL_VOC`, `ORIGINAL`) | △ |
| 値を返すメソッド(アクセサ) | `get` 接頭辞あり(`getType()`, `getEpochSize()` など 15 種類)と、名詞だけ(`type()`, `parameters()`, `snapshot()`)が混在。同じ「種類を返す」メソッドでも、`IOptimizer::type()` と `ILearningRateScheduler::getType()` で違う | ✕ |
| 名前空間 | ほとんどのクラスはグローバル。一部だけ `training::infrastructure::torchFunc` を使う | △(対象外。下を参照) |

### 個別に直すもの

| # | 内容 | 該当箇所 |
|---|---|---|
| 1 | タイポ: `updateParmeters` → `updateParameters` | `IOptimizer.hpp`、Adam / AdamW / SGD の `.hpp` / `.cpp`、`TorchModel.cpp`(計 8 か所) |
| 2 | ファイル名とクラス名が合っていない: `SchedulerFactory.hpp` → `LearningRateSchedulerFactory.hpp`。ヘッダに無名名前空間(`namespace { }`)がある | `adapters/impl/lr_scheduler/SchedulerFactory.hpp` |
| 3 | 更新の単位を表す enum の名前と場所: `adapters/impl/LearningRateSchedulerType.hpp`(`OneBatch` / `OneEpoch`)→ `LearningRateUpdateInterval { PerBatch, PerEpoch }` にして entities へ移す。entities の `LearningRateSchedulerType`(`None` / `Poly` / …)と**名前が同じ**で、両方を include すると再定義エラーになる。また、`adapters/interfaces/ILearningRateScheduler.hpp` が `adapters/impl/` を include しており、依存の向きも逆になっている | `adapters/impl/LearningRateSchedulerType.hpp`、`ILearningRateScheduler.hpp`、`lr_scheduler/*.hpp` |
| 4 | entities の `LearningRateSchedulerType`(`None` / `Poly` / …)は、proto の `oneof` → `std::variant` で種類が分かるので不要。削除する | `entities/domain-objects/Optimizer/LearningRateSchedulerType.hpp` |
| 5 | enum の値を PascalCase にそろえる: `PASCAL_VOC` → `PascalVoc`、`ORIGINAL` → `Original` | `entities/domain-objects/ImageAnnotationType.hpp` と使っている箇所 |

## 背景:C++ の「デファクトスタンダード」

C++ には、Python の PEP 8 や Rust の標準のような**言語全体で1つの命名規則はない**。代表的な規約でも書き方が違う。

| 規約 | 型 | 関数 | 変数 | メンバ変数 | ファイル・ディレクトリ |
|---|---|---|---|---|---|
| 標準ライブラリ / C++ Core Guidelines(NL.10) | snake_case | snake_case | snake_case | (規定なし) | snake_case |
| Google C++ Style Guide | PascalCase | PascalCase | snake_case | `snake_case_` | 小文字 + `_` または `-` |
| LLVM | PascalCase | camelCase | PascalCase | PascalCase | PascalCase |
| Qt(Qt Creator のコーディング規約) | PascalCase | camelCase | camelCase | `m_camelCase` | 小文字 |
| libtorch(C++ API) | PascalCase(`StepLR`) | snake_case(`zero_grad`) | snake_case | `snake_case_` | snake_case(`lr_scheduler.h`) |

共通しているのは次の 2 点だけ。この 2 点を「デファクト」とみなす。

1. **一つのコードベースの中で一貫させる**(C++ Core Guidelines **NL.8: Use a consistent naming style**)。どの規約を選ぶかより、混ぜないことが大事
2. **ファイル名・ディレクトリ名は小文字にする**(標準ライブラリ、Google、libtorch、Boost など大多数)。大文字小文字を区別しないファイルシステム(Windows / macOS の既定)で、`Optimizer/` と `optimizer/` が衝突する事故を避けられる

## 方針

**すでにそろっている識別子の書き方は変えない。そろっていないものだけ、上の「デファクト」に沿って決める。** 識別子(クラス名・関数名・メンバ名)を全部書き換えると変更が大きすぎる。いまの書き方(型は PascalCase、関数は camelCase)は Qt に近く、広く使われている形なので、変える理由がない。

### 決める規則

| 対象 | 規則 | 例 | 理由 |
|---|---|---|---|
| ディレクトリ名 | **snake_case** | `torch_func`, `domain_objects`, `lr_scheduler` | 上の「デファクト」2。Rust 側(`crates/adapters/src/training/to_proto`)もモジュール名は snake_case なので、リポジトリ全体でそろう |
| ファイル名(src) | 中の主なクラスと同じ PascalCase。拡張子は `.hpp` / `.cpp` | `PolyLR.hpp` | いまの規則(269 ファイル)を続ける。ファイル名からクラス名が分かる |
| ファイル名(関数だけのヘッダ) | 中身を表す PascalCase | `GraphValidation.hpp` | いまの規則を続ける |
| ファイル名(tests) | snake_case + `_test` | `poly_lr_test.cpp` | いまの規則を続ける。CMake のテスト実行ファイル名と同じにできる(googletest でもよく使われる形) |
| 型 | PascalCase。インターフェースは `I` 接頭辞 | `ILearningRateScheduler` | いまの規則を続ける |
| 略語 | 型名の中では大文字のまま | `SGDOptimizer`, `PolyLR`, `DAG` | いまの使い方に合わせる |
| 関数・メソッド | camelCase | `learningRateAt` | いまの規則を続ける |
| ローカル変数・引数 | camelCase | `totalSteps` | いまの規則を続ける |
| メンバ変数 | `_camelCase` | `_baseLr` | いまの規則を続ける(下の注を参照) |
| enum の値 | PascalCase | `PerBatch`, `PascalVoc` | 大半がこの形。UPPER_SNAKE はマクロと見分けにくい(Core Guidelines **Enum.5: Don't use ALL_CAPS for enumerators**) |
| 名前空間(使う場合) | snake_case | `shape_rules_detail` | 標準ライブラリ・libtorch と同じ |

メンバ変数の `_` 接頭辞について: C++ では、`_` + 大文字で始まる名前(`_Type`)と `__` を含む名前は、どこで使っても処理系の予約名になる。`_` + 小文字で始まる名前は、グローバル名前空間でだけ予約されている。クラスのメンバ `_type` は規格上問題ないが、**`_` の直後を大文字にしない**ことを規則に含める。

### 進め方

一度に全部変えると差分が大きくなり、レビューも `git blame` も追いにくくなる。段階に分けて PR を分ける。

| 段階 | 内容 | 規模の目安 |
|---|---|---|
| 1 | 規則を `/workspaces/CLAUDE.md` の「コーディング方針」に書く(Claude が新しいファイルを作るときにも従えるようにする) | ドキュメントのみ |
| 2 | 「個別に直すもの」の 1〜5 | 小。学習率スケジューラの作業(feat/LearningRateScheduler)と一緒に入れてよい |
| 3 | ディレクトリ名を snake_case にする(層ごとに PR を分ける) | 大。下の表 |
| 4 | アクセサの書き方をそろえる(下の「決めること」で決めた方へ) | 中 |

段階 3 で変えるディレクトリと、include を書き換えるファイル数(2026-11-22 時点):

| 変更前 | 変更後 | include を直すファイル数 |
|---|---|---|
| `entities/domain-objects` | `entities/domain_objects` | 100 |
| `.../ModelGraph` | `.../model_graph` | 46 |
| `infrastructure/torchFunc` | `infrastructure/torch_func` | 42 |
| `.../ModelGraph/Layers` | `.../model_graph/layers` | 21 |
| `infrastructure/torchModel` | `infrastructure/torch_model` | 19 |
| `.../ModelGraph/DAG` | `.../model_graph/dag` | 14 |
| `.../Metrics` | `.../metrics` | 9 |
| `.../DataSpecs` | `.../data_specs` | 8 |
| `parallelProcessFn`(adapters / application の 2 か所) | `parallel_process_fn` | 8 |
| `infrastructure/readConfig` | `infrastructure/read_config` | 2 |
| `.../Optimizer` | `.../optimizer` | 段階 2 の 3・4 の後で数える |

- ディレクトリの移動は `git mv` で行い、履歴を残す(`git log --follow` で追えるようにする)
- 大文字小文字だけが変わる変更(`Metrics` → `metrics`)は、大文字小文字を区別しないファイルシステムでは `git mv` が失敗することがある。一度別の名前に移してから戻す(`git mv Metrics metrics_tmp && git mv metrics_tmp metrics`)
- include の書き換えは機械的に行い(`sed`)、手で直さない
- `CMakeLists.txt` の中のパス(3 か所)も直す。ソースは `file(GLOB_RECURSE ...)` で集めているので、移動した後は cmake を再実行する
- 名前空間 `training::infrastructure::torchFunc` は、ディレクトリと合わせて `torch_func` にする
- `docs/` の中で旧パスを書いている箇所も直す(`gpu-support.md` など)

## 確認(段階ごと)

- `cmake -S . -B build` をやり直してから `cmake --build build -j2` が通る
- テストがすべて通る(`ctest`)
- `grep -rn '旧ディレクトリ名/' src tests CMakeLists.txt` が 0 件
- Windows / macOS でチェックアウトしても、大文字小文字だけが違うパスが残っていない(`git ls-files | sort -f | uniq -di` が空)

## 決めること(実装前)

- **アクセサの書き方**: どちらかにそろえる
    - `get` 接頭辞を付ける(`getType()`)。いまの多数派(15 種類)なので、変更が少ない
    - 名詞だけにする(`type()`)。標準ライブラリ(`size()`, `data()`)や Google / Core Guidelines と同じ
- **段階 3 をいつやるか**: 変更が大きく、ほかのブランチと衝突しやすい。作業中のブランチがないときにまとめて行う
- **tests のファイル名**: src と同じ PascalCase にそろえるか、いまの snake_case のままにするか(この issue では「いまのまま」を提案)

## 対象外(別issue)

- **名前空間の導入**: ほとんどのクラスがグローバル名前空間にある。`training::entities` のように層ごとの名前空間を入れると名前の衝突(今回の `LearningRateSchedulerType` のような問題)を防げるが、全ファイルの変更になるので別に扱う
- **Rust 側・フロントエンドの命名**: それぞれ言語の標準(rustfmt / clippy、ESLint)に従っているので対象外
- **proto の命名**: Protocol Buffers のスタイルガイド(メッセージは PascalCase、フィールドは snake_case)に従っているので対象外
