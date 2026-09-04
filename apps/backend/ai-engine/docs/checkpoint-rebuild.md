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

`model_graph` セクションの中身（`ModelGraphArchive`）:

| キー | 内容 |
|---|---|
| `format_version` | int64。`*Params` のレイアウトが変わったら上げる |
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
| `infrastructure/torchModel/ModelGraphArchive.{hpp,cpp}` | infrastructure | `ModelGraph` ⇄ torch archive。`LayerKind` / `format_version` |
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

### 5.4 Optimizer のデストラクタを `.cpp` へ移した

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

### 5.5 `IModel::parameters()` を純粋仮想にした影響

`IModel` の実装は `TorchModel` と、テストの `FakeModel`(`model_evaluator_test.cpp`) の 2 つ。
両方に実装を追加済み。今後 `IModel` を実装するクラスは `parameters()` が必須になる。

---

## 6. テスト

### `tests/model_graph_archive_test.cpp`

| ケース | 内容 |
|---|---|
| 全 5 層種のラウンドトリップ | Conv2D / BatchNorm / Activation / Pooling / Linear を含む `ModelGraph` を書き → 読み戻して fingerprint 一致 |
| 個別フィールド検証 | `Conv2DParams` の各値、`BatchNormParams` の double、enum（`ActivationType` / `PoolingType`）、`LinearParams::bias` |
| 空グラフ | `layer_count = 0` のラウンドトリップ |
| 異常系 | `format_version` 不一致で `runtime_error` |

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

### 既存テストへの影響

- `checkpoint_roundtrip_test` — `CheckpointArchiveIO` へのリファクタ後も無変更で通過
- `model_evaluator_test` — `FakeModel` に `parameters()` を追加

---

## 7. 既知の穴 / 今後の課題

| 項目 | 内容 |
|---|---|
| **Optimizer 種別が checkpoint に無い** | Adam で保存した `.pt` を SGD として `load()` しても検出できない。libtorch の `Optimizer::load` が状態キーの不一致でどう振る舞うかも未確認。`optimizer_type` を archive に書いて照合するのが対策 |
| **`OptimizerConfig` の派生フィールドが届かない** | `AppConfig` は `OptimizerConfig` を基底の値で持つため、`AdamOptimizerConfig::beta1` などはスライシングで消える。factory は `type` / `learningRate` / `weightDecay` のみ使い、残りはコンストラクタ既定値。`std::variant` 化か多相化が要検討 |
| **`format_version` の移行パス** | 現在は不一致なら例外。旧版を読む必要が出たら version 別の読み分けが要る |
| **fingerprint とシリアライザのフィールド列挙が重複** | `ModelGraphFingerprint`（entities、libtorch 非依存）と `ModelGraphArchive`（infrastructure）が同じフィールドを別々に列挙している。層を追加すると両方の更新が必要（`static_assert` で検出はされる） |
| **resume 本体は未実装** | `TrainModelUsecase` は依然 epoch 0 から回る。開始 epoch の受け渡しと `BestMetricTracker` の初期化は `docs/issues/training-resume.md` の担当 |

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
