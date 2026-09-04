# チェックポイントからのモデル再構築（Phase 2）実装メモ

`docs/issues/optimizer-state-save.md` の残タスク
「構造復元（ModelGraph のシリアライズ）と重みロードの結合」の実装記録。

ブランチ: `feature/checkpoint-model-rebuild`

---

## 1. 何が問題だったか

Phase 1 までの checkpoint（`.pt`）には **モデルの重みしか入っていなかった**。
構造（`ModelGraph`）は入っていないため、復元するには

```cpp
ModelGraph graph = buildSampleModelGraph(numClasses);   // ← 呼び出し側が「保存時と同じもの」を手で組む
auto model = std::make_shared<TorchModel>(graph, builder);
auto optimizer = std::make_shared<AdamOptimizer>(model->parameters(), 0.001);
TorchCheckpointStore store(model, optimizer, dir, name, graph);
store.loadFrom(path);   // ← ここでようやく重みが入る
```

という前提が必要だった。構造がズレると Phase 1 で入れた fingerprint 照合が
弾いてくれる（それ以前は `model_param_count` 不一致の分かりにくい例外）が、
**「.pt を渡されただけでモデルを起こす」ことはできなかった**。

Phase 2 のゴールは次の1行にすること。

```cpp
RestoredCheckpoint r = loader.load(ptPath, appConfig.optimizer);
// r.model / r.optimizer / r.graph / r.meta がすべて揃っている
```

---

## 2. 全体像

```
                       ┌─────────────────────────────────────────┐
   .pt ファイル         │ CheckpointModelLoader::load()           │
   ┌──────────────┐    │                                         │
   │ model_graph  │───▶│ 1. readModelGraphFromCheckpoint()       │
   │ model        │    │      → ModelGraph                       │
   │ optimizer    │    │ 2. IModelFactory::create(graph)         │
   │ epoch        │    │      → IModel                           │
   │ best_metric  │    │ 3. IModel::parameters()                 │
   │ fingerprint  │    │    IOptimizerFactory::create(params,cfg)│
   └──────────────┘    │      → IOptimizer                       │
                       │ 4. readCheckpointArchive()              │
                       │      → 重み・optimizer状態・meta を注入  │
                       └─────────────────────────────────────────┘
                                        │
                                        ▼
                              RestoredCheckpoint
                       { model, optimizer, parameters, graph, meta }
```

順序が重要：**構造 → モデル → optimizer → 重み**。
optimizer はコンストラクタで「更新対象パラメータ」を受け取るため、
モデルを先に組まないと作れない。

---

## 3. checkpoint（.pt）のレイアウト

| キー | 型 | 内容 | 追加時期 |
|---|---|---|---|
| `model` | nested archive | モデル重み（`model_param_count` + `model_param_N`） | 既存 |
| `optimizer` | nested archive | Optimizer 内部状態（libtorch の `Optimizer::save` に委譲） | 既存 |
| `epoch` | int64 tensor | 保存時の epoch | 既存 |
| `best_metric` | float64 tensor | 保存時のベスト指標（float32 に丸めないため kFloat64 明示） | 既存 |
| `model_graph_fingerprint` | string (IValue) | 構造のハッシュ。照合用 | **Phase 1** |
| `model_graph` | nested archive | 構造そのもの。再構築用 | **Phase 2** |
| `optimizer_type` | string (IValue) | `Adam` / `AdamW` / `SGD`。取り違え検出用 | **Phase 2** |
| `rng_state_cpu` | uint8 tensor | CPU 乱数生成器の状態。学習再開の再現性用（§5.9） | **Phase 2** |

`model_graph` セクションの中身（`ModelGraphArchive`）:

| キー | 内容 |
|---|---|
| `format_version` | int64。キー名・構成が変わったら上げる。読み側は「現行超 = 読めない / 現行未満 = version 別に読み分け（現在 v1 のみ）」で分岐（§5.10） |
| `layer_count` | int64 |
| `layer_{i}_kind` | int64。`LayerKind`（0=Conv2D, 1=Pooling, 2=BatchNorm, 3=Linear, 4=Activation） |
| `layer_{i}_<field>` | 各 `*Params` のフィールド。int64 / float64 のスカラーテンソル |

**JSON などの外部フォーマットは使っていない。** 追加の設定ファイル・依存ライブラリは不要。
チェックポイントと同じ torch archive にそのまま書くことで、
「重み + optimizer 状態 + 構造」が 1 ファイルに閉じる。

---

## 4. 追加・変更したファイル

### 新規

| ファイル | 層 | 役割 |
|---|---|---|
| `entities/domain-objects/LayersParamsFields.hpp` | entities | 層パラメータのフィールド定義を集約（`LayerKind` / `visitLayerFields`）。ハッシュ・書き出し・読み込みの唯一の源（§5.6） |
| `infrastructure/torchModel/ModelGraphArchive.{hpp,cpp}` | infrastructure | `ModelGraph` ⇄ torch archive。`format_version` |
| `adapters/interfaces/IModelFactory.hpp` | adapters | `ModelGraph` → `IModel` のポート |
| `adapters/interfaces/IOptimizerFactory.hpp` | adapters | `(parameters, OptimizerConfig)` → `IOptimizer` のポート |
| `infrastructure/torchModel/TorchModelFactory.{hpp,cpp}` | infrastructure | `IModelFactory` の libtorch 実装（`TorchLayerBuilder` を内包） |
| `infrastructure/torchFunc/TorchOptimizerFactory.{hpp,cpp}` | infrastructure | `IOptimizerFactory` の libtorch 実装（`OptimizerType` で分岐） |
| `infrastructure/torchModel/CheckpointArchiveIO.{hpp,cpp}` | infrastructure | checkpoint レイアウトの読み書きを集約 |
| `infrastructure/torchModel/CheckpointModelLoader.{hpp,cpp}` | infrastructure | 再構築フロー本体。`RestoredCheckpoint` を返す |
| `tests/model_graph_archive_test.cpp` | test | `ModelGraph` ラウンドトリップ |
| `tests/checkpoint_rebuild_test.cpp` | test | `.pt` 単体からの再構築 |

### 変更

| ファイル | 変更内容 | 理由 |
|---|---|---|
| `adapters/interfaces/IModel.hpp` | `virtual std::vector<at::Tensor> parameters() const = 0;` を追加 | Loader が `IModel` 越しに optimizer を組むために必要。`IModel` は既に `at::Tensor` を露出しているので新たな依存は増えない |
| `adapters/interfaces/IOptimizer.hpp` | `virtual OptimizerType type() const = 0;` を追加 | checkpoint に種別を記録し、取り違えを検出するため（§5.4） |
| `entities/domain-objects/OptimizerTypeName.hpp` | 新規。`optimizerTypeName()` | 種別の永続化・表示用の名前 |
| `entities/domain-objects/OptimizerConfig.hpp` | 継承 → `std::variant` へ | スライシングで `beta1` / `momentum` が factory に届かなかった（§5.5） |
| `infrastructure/readConfig/ConfigReader.cpp` | optimizer 設定を全行読了後に組み立て。`beta1` / `beta2` / `eps` / `momentum` / `nesterov` キーを追加 | 行順に依存せず variant を作るため |
| `entities/domain-objects/ModelGraphFingerprint.cpp` | フィールド列挙を `visitLayerFields` に委譲 | 3 か所の重複を解消（§5.6） |
| `infrastructure/torchModel/CheckpointArchiveIO.{hpp,cpp}` | `rng_state_cpu` の読み書き、`restoreCpuRngStateIfPresent()` | 学習再開の再現性（§5.9） |
| `infrastructure/torchModel/CheckpointModelLoader.{hpp,cpp}` | `RestoredCheckpoint::rngStateRestored`、load の最後で RNG 復元 | 再開経路でのみ乱数状態を戻す（§5.9） |
| `infrastructure/torchModel/ModelGraphArchive.cpp` | `format_version` を新旧で分岐 | 移行ポリシーの明示（§5.10） |
| `infrastructure/torchModel/TorchModel.hpp` | `parameters()` に `override` を付与 | 実装は既存のまま |
| `infrastructure/torchModel/TorchCheckpointStore.cpp` | 読み書きを `CheckpointArchiveIO` に委譲。約 50 行 → 約 10 行 | Store と Loader でレイアウトを二重定義しないため |
| `main.cpp` | model / optimizer を factory 経由に。optimizer は `appConfig.optimizer` から生成 | cold start と再構築で同じ生成口を通す |
| `tests/model_evaluator_test.cpp` | `FakeModel` に `parameters()` を追加 | `IModel` の純粋仮想関数追加への追従 |
| `CMakeLists.txt` | テスト 2 つを追加 | — |

---

## 5. 設計判断とその理由

### 5.1 なぜ `ICheckpointStore` に再構築メソッドを足さなかったか

`ICheckpointStore` は **「構築済みの model / optimizer を注入され、そこへ in-place に復元する」** ポート。
`loadFrom()` は `CheckpointMeta` を返すだけで、model は外から与えられている。

一方 Loader は **model / optimizer を持たない状態から作り出す**。
戻り値の形（`RestoredCheckpoint`）も責務も違うため、同じインタフェースに混ぜると
「注入されているのか、生成するのか」が呼び出し側から読めなくなる。

→ **`ICheckpointStore` は無変更**。Loader は独立した型にした。
これは `docs/issues/training-resume.md` の「薄い `TrainingBootstrap` に切り出す」案に沿う。

### 5.2 なぜ `CheckpointArchiveIO` を切り出したか

Loader が自前で archive を読むと、`model` / `optimizer` / `epoch` / `best_metric` /
fingerprint のキー名と読み順が Store と Loader の 2 か所に散る。
フォーマットを変えるときに片方だけ直して壊れる典型パターン。

→ レイアウトの知識を 1 ファイルに集約し、Store も Loader もそこを呼ぶ形にした。
既存の `checkpoint_roundtrip_test` がそのまま通ることで、リファクタの安全性を確認している。

### 5.3 `readCheckpointArchive` の fingerprint 照合について

引数 `expectedGraph` の fingerprint と archive のそれを常に照合する。

- **Store 経路**：呼び出し側が用意した graph と照合 → 構造違いを弾く（Phase 1 の目的）
- **Loader 経路**：checkpoint から読んだ graph を渡すので必ず一致 → 自己整合性の確認

「Loader のときは照合不要だから nullable にする」案もあったが、
API が `const ModelGraph*` になって呼び出し側で分岐が要るため、
常に非 null の参照を取る形にした。余分なハッシュ計算 1 回は無視できる。

### 5.4 Optimizer の種別を `IOptimizer` 自身に答えさせた

checkpoint の optimizer 状態は種別ごとに中身が全く違う
（Adam は `exp_avg` / `exp_avg_sq` / `step`、SGD は `momentum_buffer`）。
にもかかわらず種別が記録されていなかったため、
「Adam で保存した `.pt` を SGD で読む」を検出できなかった。

記録元をどこから取るかで 2 案:

- **A: `IOptimizer::type()` を追加し、Optimizer 自身に答えさせる**（採用）
- B: `writeCheckpointArchive` に `OptimizerConfig` を渡す

B は「実際に生成された Optimizer」ではなく「生成時に指定された config」を
書くことになり、両者がズレたときに嘘の値が残る。
A なら実体そのものが答えるのでズレようがない。
`OptimizerType` は entities なので、adapters の `IOptimizer` から参照しても
依存方向を壊さない（`IModel::parameters()` と同じ判断）。

名前は `optimizerTypeName()`（entities の純粋関数）で文字列化して書く。
int の enum 値ではなく文字列にしたのは、enum の並び替えで
過去の `.pt` が壊れないようにするため。エラーメッセージもそのまま読める。

### 5.5 `OptimizerConfig` を継承から `std::variant` へ

当初は継承だった。

```cpp
struct OptimizerConfig { OptimizerType type; double learningRate; double weightDecay; };
struct AdamOptimizerConfig : OptimizerConfig { double beta1, beta2, eps; };
```

しかし `AppConfig` が `OptimizerConfig optimizer;` と **基底の値で** 保持していたため
スライシングが起き、`beta1` / `momentum` は factory に届かないまま捨てられていた。
しかも `OptimizerConfig` に仮想関数が無いので `dynamic_cast` で拾い直すこともできない。

→ 同じリポジトリ内で既に使われている `LayersParams`（層パラメータ）と同じ
`std::variant` 方式に揃えた。

```cpp
using OptimizerConfig = std::variant<AdamOptimizerConfig, AdamWOptimizerConfig, SGDOptimizerConfig>;
```

- 各構造体は独立し、種別固有のフィールドだけを持つ（`learningRate` / `weightDecay` は各々が持つ）
- `TorchOptimizerFactory` は `TorchLayerBuilder` と同じ `std::visit` + `Overloaded` で分岐
- 種別を足すと `std::visit` が全 alternative を要求するため、**対応漏れがコンパイルエラーになる**
- 種別だけ欲しい箇所のために `optimizerTypeOf(const OptimizerConfig&)` を entities に用意

`ConfigReader` は行順が自由（`optimizer_type` が `learning_rate` より後でもよい）なので、
パース中は `std::optional` のフィールド集合に貯め、全行読了後に variant を組み立てる。

### 5.6 fingerprint とシリアライザのフィールド列挙を 1 か所に

`ModelGraphFingerprint`（entities・ハッシュ計算）と `ModelGraphArchive`
（infrastructure・書き出し／読み込み）が、それぞれ独立に全フィールドを列挙していた。
層のパラメータを 1 つ増やすと **3 か所**（ハッシュ・write・read）を直す必要があり、
片方の更新漏れが起きやすい。

→ entities に `LayersParamsFields.hpp` を置き、フィールド定義を 1 回だけ書く。

```cpp
template <class Params, class F>
void visitLayerFields(Params &p, F &&f)   // const / 非 const の両方で使える
{
    if constexpr (std::is_same_v<T, Conv2DParams>) {
        f("in_channels", p.inChannels);
        ...
    }
}
```

- **fingerprint**: 訪問して値を正規化文字列へ連結
- **write**: 訪問して `layer_{i}_<name>` のテンソルへ書く
- **read**: 「非 const の `Params`」を訪問し、来た可変参照へ archive の値を代入する

`LayerKind` と層種タグ（`"conv2d"` 等）も同ファイルへ移し、
「どんな層があるか」の定義も 1 か所にした。

**後方互換**: フィールドの並び順・区切り文字を保ったため、fingerprint の文字列は
バイト単位で以前と同一。既知グラフに対する値
（`Conv2D(3,21,3,1,1)` → `47f17d6aca1c1936`）を
`model_graph_archive_test` に固定し、過去の `.pt` が読めなくなる変更を検出できるようにした。

### 5.7 Optimizer のデストラクタを `.cpp` へ移した

factory を作った時点で `TorchOptimizerFactory.cpp` が
`invalid application of 'sizeof' to incomplete type 'torch::optim::Adam'`
でコンパイルできなくなった。

原因は `AdamOptimizer` 等が

```cpp
std::unique_ptr<torch::optim::Adam> _optim;  // torch::optim::Adam は前方宣言のみ
// デストラクタの宣言がない → コンパイラがヘッダ内で暗黙生成
//   → その場で ~unique_ptr<Adam> = sizeof(Adam) が要求される
```

という状態だったこと。これまでは `main.cpp` が `<torch/torch.h>` を
include していたためたまたま通っていた。

→ 3 つの Optimizer すべてでヘッダに `~XxxOptimizer() override;` を宣言し、
`.cpp` 側（`<torch/torch.h>` を include 済みで完全型が見える場所）で
`= default` を定義した。これにより **生成側の TU は libtorch を知らなくてよくなった**。

なお `shared_ptr` はデリータを型消去するため、`shared_ptr<IOptimizer>` を
受け取る adapters / application 層はもともと影響を受けない
（破棄コードは `make_shared` した TU に埋め込まれる）。
問題になるのは「具象型を生成・破棄する TU」だけ。

### 5.8 `IModel::parameters()` を純粋仮想にした影響

`IModel` の実装は `TorchModel` と、テストの `FakeModel`(`model_evaluator_test.cpp`) の 2 つ。
両方に実装を追加済み。今後 `IModel` を実装するクラスは `parameters()` が必須になる。

### 5.9 CPU 乱数状態の保存を先に配線した

厳密な「同じ軌跡での学習再開」には、保存時点の乱数生成器の状態が要る。

現在の学習ループには乱数を消費する箇所が**まだ無い**（データシャッフルも dropout も
データ拡張も未実装）ため、これは今すぐ効く機能ではない。それでも先に入れたのは:

- 後から足すと「実は再開が非再現だった」と気付いてからの retrofit になる
- コストが小さい（`archive.write("rng_state_cpu", currentCpuRngState())` の 1 行、数 KB）
- 研究用途では再現性の優先度が高い

**restore は再開経路（`CheckpointModelLoader::load`）でのみ行う。**
`TorchCheckpointStore::loadFrom`（推論目的で重みだけ読む経路）でグローバルな
乱数状態を書き換えるのは副作用として不適切なため触らない。
`load()` 内では「モデル生成 → …→ `restoreCpuRngStateIfPresent`」の順で、
モデル生成が消費した分も最後の restore で保存時の状態へ戻る。

GPU 生成器の状態は含めていない（GPU 学習が未対応。対応時に `rng_state_cuda` を足す）。

`RestoredCheckpoint::rngStateRestored` で「復元できたか（＝旧 checkpoint でないか）」を
呼び出し側に伝える。

### 5.10 `format_version` の運用ポリシーを明示した

以前は「現行と不一致なら即例外」だった。読み側を次の方針で分けた:

| archive の version | 挙動 |
|---|---|
| 現行より新しい | 読めない（レイアウト不明）。ai-engine の更新を促すエラー |
| 現行より古い | version ごとに読み分ける。**現在は v1 のみなので該当なし**（例外） |
| 現行と一致 | 通常読み込み |

v2 を導入するときは「v1 の read パスを残したまま v2 の分岐を足す」。
`model_graph_archive_test` に **v1 の archive キー集合を固定するテスト**を追加し、
`format_version` を上げずにレイアウトを壊す変更をコンパイル後に検出できるようにした
（`Conv2D` 1 層 → `{format_version, layer_count, layer_0_kind, layer_0_in_channels,
layer_0_out_channels, layer_0_kernel_size, layer_0_stride, layer_0_padding}`）。

---

## 6. テスト

### `tests/model_graph_archive_test.cpp`

| ケース | 内容 |
|---|---|
| 全 5 層種のラウンドトリップ | Conv2D / BatchNorm / Activation / Pooling / Linear を含む `ModelGraph` を書き → 読み戻して fingerprint 一致 |
| 個別フィールド検証 | `Conv2DParams` の各値、`BatchNormParams` の double、enum（`ActivationType` / `PoolingType`）、`LinearParams::bias` |
| 空グラフ | `layer_count = 0` のラウンドトリップ |
| フォーマット固定 | `Conv2D` 1 層の archive キー集合が既知の値と一致（レイアウト非破壊） |
| 異常系 | 現行より新しい `format_version` で `runtime_error` |

### `tests/checkpoint_rebuild_test.cpp`

構造は Conv → ReLU → Conv（単層より非自明にするため）。

| ケース | 内容 |
|---|---|
| 構造の復元 | 復元した `ModelGraph` の fingerprint が保存時と一致、層数 3 |
| 重みの復元 | **graph を一切渡さず** `.pt` のパスだけで重みが一致 |
| optimizer 状態の復元 | 復元後に同一ステップを踏むと元と重みが一致（Adam の `exp_avg` / `exp_avg_sq` / `step` が戻っている証明） |
| meta の復元 | `epoch` / `bestMetric` |
| 異常系 | 存在しないファイル → `runtime_error` |
| 異常系 | `model_graph` を含まない（構造保存前の）`.pt` → 明示的な `runtime_error` |
| 異常系 | optimizer 種別の取り違え（Adam 保存 → SGD 読み）→ `runtime_error` |
| 乱数状態の復元 | ロード後に引く乱数列が保存時の続きと一致 |
| 旧形式互換 | `rng_state_cpu` を持たない archive は警告のみ・続行可能 |

### 既存テストへの影響

- `checkpoint_roundtrip_test` — `CheckpointArchiveIO` へのリファクタ後も無変更で通過
- `model_evaluator_test` — `FakeModel` に `parameters()` を追加

---

## 7. 既知の穴 / 今後の課題

| 項目 | 内容 |
|---|---|
| **LR スケジューラの状態** | スケジューラ機能そのものが未実装。実装時に checkpoint へ進行状態を足す |
| **GPU 乱数状態** | `rng_state_cpu` のみ保存。GPU 学習対応時に `rng_state_cuda` を追加 |
| **`OptimizerConfig` の派生を跨ぐ再開** | 保存時 Adam の checkpoint を config で AdamW 指定して読むと `optimizer_type` 照合で弾かれる（正しい挙動）。「同じ状態を別 optimizer に引き継ぐ」ことは想定しない |
| **出力ディレクトリ運用** | resume は同じ `output_dir` に追記する。`best.pt` は旧ベストを引き継ぐので悪化時は上書きされない。別 run として切り分けたい場合は `output_dir` を分ける運用 |

### 解決済み（履歴）

- 構造の再構築（§全体） / optimizer 種別の記録（§5.4） /
  `OptimizerConfig` スライシング（§5.5） / フィールド列挙の重複（§5.6） /
  CPU 乱数状態（§5.9） / `format_version` の運用ポリシー（§5.10）
- resume 本体（開始 epoch・`saveLast`・tracker 引き継ぎ）→ `docs/issues/training-resume.md`

---

## 8. 設定ファイルについて

**Phase 2 で新しい設定ファイル（JSON など）の追加は不要。**

`.config` は既に以下を持っており、`TorchOptimizerFactory` はこれをそのまま使う。

```
optimizer_type = Adam
learning_rate  = 0.005
# weight_decay = 0.0   （省略可。ConfigReader は対応済み）
```

なお `main.cpp` を factory 経由にしたことで、
**これまで無視されていた `.config` の `learning_rate` が実際に効くようになった**
（従来は `AdamOptimizer(params, 0.001)` とハードコードされていた）。

resume を配線する段階では `resume_from` / `save_last_every` といったキーが要るが、
それは `docs/issues/training-resume.md` の範囲。

---

## 関連

- `docs/issues/optimizer-state-save.md` — 本タスクの元 issue
- `docs/issues/training-resume.md` — 学習再開の配線（本メモの成果物を使う側）
- `docs/issues/checkpoint-store-refactor.md` — `ICheckpointStore` の切り出し
