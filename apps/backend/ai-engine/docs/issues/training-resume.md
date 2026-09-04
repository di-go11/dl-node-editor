# feat: 学習再開(resume)機能

## 背景 / 問題

`ICheckpointStore` に `loadBest()` / `loadFrom(path)` を追加し、`TorchCheckpointStore` で
重み + optimizer 状態 + epoch の復元を実装した(→ checkpoint-store-refactor.md)。
`checkpoint_roundtrip_test.cpp` で復元の正しさも検証済み。

しかし **これを呼んで学習を途中から再開する経路が存在しない**。現状:

- `TrainModelUsecase::execute` のループは常に `epoch = 0` から `_param->getEpochSize()` まで回る
- `BestMetricTracker` は毎回まっさらな状態で作られる
- `saveBest` は「指標が最良のエポック」の状態しか保存しない

### `saveBest` だけでは resume できない理由

| 問題 | 内容 |
|---|---|
| best ≠ last | epoch 40 で中断、best が epoch 12 なら、best から再開すると 28 エポック分の optimizer モーメント・LR 進捗が消える。resume には「**直近(last)**」の状態が要る |
| ループ状態が揮発 | `epoch` カウンタと `BestMetricTracker` は `execute()` のローカル変数。永続化されていない |
| best 指標の未復元 | 再開後に tracker が空だと、最初のエポックが「初回 = 常に improvement」扱いになり、**より悪いモデルで `best.pt` を上書き**する |

## 設計方針

resume は **方針**(config / GUI トグル / ファイル選択)であって学習ループのロジックではない。
「いつ・どこから再開するか」は合成層が決め、`TrainModelUsecase` は**開始状態を受け取るだけ**にする。

### 1. チェックポイントを best / last に分ける

- `saveBest(epoch)` — 既存。評価指標が最良を更新したとき。推論・デプロイ用。
- **`saveLast(epoch)`** — 毎エポック、または N エポックごと。中断・再開用。resume はこちらから読む。
- ファイルは `<modelName>_best.pt` / `<modelName>_last.pt` に分ける。
  `checkpointPath()` を `checkpointPath(CheckpointKind kind)` に拡張し出し分ける。

### 2. `CheckpointMeta` で復元メタを返す

```cpp
// entities/domain-objects/CheckpointMeta.hpp
struct CheckpointMeta
{
    unsigned int epoch = 0;      // 保存時の epoch(解釈は呼び出し側)
    double bestMetric = 0.0;     // 保存時点のベスト指標値
    // MetricMode を持たせるかは要検討(下記「検討事項」)
};
```

- `loadBest()` / `loadLast()` / `loadFrom(path)` はすべて `CheckpointMeta` を返す(型を統一)。
- `.epoch` の意味:
  - `loadLast()` → 最後に完了したエポック。呼び出し側は `startEpoch = epoch + 1`
  - `loadBest()` → best を記録したエポック(情報用。ここから resume はしない)
  - `loadFrom(path)` → その .pt に入っている epoch
- archive に `epoch` と `best_metric` を書く。読む側は `try_read` で旧 .pt との後方互換を確保。

### 3. `TrainModelUsecase` が開始状態を受け取る

```cpp
// application/impl
struct TrainingResumeState
{
    unsigned int startEpoch = 0;
    double initialBest = 0.0;
    bool hasInitialBest = false;
};

void execute(const TrainingDatasets &datasets, const TrainingResumeState &resume = {});
```

- ループを `for (epoch = resume.startEpoch; epoch < total; ++epoch)` に
- `BestMetricTracker` を `resume.hasInitialBest` なら `resume.initialBest` で初期化
- 毎エポック(or N ごと)に `_checkpointStore->saveLast(epoch)` を追加

### 4. 合成層(`main.cpp`、将来は API ハンドラ)のフロー

1. model / optimizer / trainer / evaluator / checkpointStore を構築
2. resume するか判定
   - config が `resumeFrom` を指定 → `checkpointStore->loadFrom(resumeFrom)`
   - 指定なしだが `<modelName>_last.pt` が存在 → `checkpointStore->loadLast()`(自動再開)
   - どちらもなし → cold start
3. 取得した `CheckpointMeta` から `TrainingResumeState` を組む
4. `usecase.execute(datasets, resumeState)`

別案: この「探す → ロード → 開始状態を組む」を薄い `TrainingBootstrap` に切り出し、
cold start と resume を明示的に分ける。現状の規模なら `main.cpp` 直書きで可。

### 5. config ノブ(AppConfig / TrainParam)

| 項目 | 意味 |
|---|---|
| `resumeFrom: std::string`(空 = 自動判定) | どの .pt から再開するか。GUI のファイル選択結果もここ |
| `saveLastEvery: unsigned int`(0 = 毎エポック) | last チェックポイントの頻度。I/O 負荷とのトレードオフ |
| resume 時の出力先 | 同じ run に追記 / 新 `outputDir` を切る(要決定) |

## タスク

### store 層(完了)

- [x] `CheckpointMeta.hpp`(`entities/domain-objects`)を追加(`epoch` + `bestMetric`、`#pragma once`)
- [x] `ICheckpointStore`: `saveLast(const CheckpointMeta&)` 追加、`save*` は `CheckpointMeta` 受け取り、
      `loadBest` / `loadLast` / `loadFrom` を `CheckpointMeta` 返却に統一
- [x] `TorchCheckpointStore`:
  - [x] `checkpointPath(CheckpointKind)` で `_best.pt` / `_last.pt` 出し分け(`CheckpointKind` は private ネスト enum)
  - [x] `saveBest` / `saveLast` を `writeCheckpoint(path, meta)` 共通ヘルパに集約
  - [x] archive に `epoch`(int64)と `best_metric`(**kFloat64 明示** — `torch::tensor(double)` は float32 になり精度が落ちるため)を書く
  - [x] `loadFrom` は全キーを読んで `CheckpointMeta` を返す
  - [x] `loadBest` / `loadLast` は `loadFrom(checkpointPath(kind))` の糖衣
- [x] テスト
  - [x] `FakeCheckpointStore`(best_checkpoint_test)を全5メソッド + `CheckpointMeta` 対応に更新
  - [x] `checkpoint_roundtrip_test`: `CheckpointMeta` の epoch / bestMetric ラウンドトリップ、
        best/last のファイル分離(`saveLast` が `_best.pt` を壊さない、`loadBest`/`loadLast` が
        正しいファイルを読む)、Adam 状態復元、異常系
  - この過程で **`best_metric` が float32 に丸められる不具合をテストが検出 → kFloat64 で修正**

### モデル再構築の土台(完了 → optimizer-state-save.md / docs/checkpoint-rebuild.md)

- [x] `ModelGraph` を checkpoint に保存(`ModelGraphArchive`)
- [x] `IModelFactory` / `IOptimizerFactory` とその libtorch 実装
- [x] `CheckpointModelLoader::load(path, optimizerConfig)` → `RestoredCheckpoint`
      (model / optimizer / parameters / graph / meta)。resume 時に
      「保存時と同じ `ModelGraph` を呼び出し側が組み直す」必要がなくなった

### resume 配線(完了)

- [x] `BestMetricTracker` に「初期ベスト値で構築」する経路
      → `BestMetricTracker(MetricMode, double initialBest)` を追加
- [x] `TrainingResumeState`(application/impl)を定義
      → `startEpoch` / `initialBest` / `hasInitialBest`
- [x] `TrainModelUsecase`: `TrainingResumeState` を受け取り、ループ開始 epoch と
      tracker を初期化、毎エポック `saveLast`
      → `execute(datasets, resume = {})`。`saveLastEvery` で頻度を制御し、
        最終エポックは設定に関わらず必ず保存。
        `startEpoch >= epochSize` のときは警告して 0 エポックで終了
- [x] `main.cpp`: resume 判定 → `loadFrom` / 自動 `_last.pt` 検出 → `execute` へ配線
      → 再開は `CheckpointModelLoader` を使うため、保存時と同じ `ModelGraph` を
        手組みする必要がない。復元した構造が現在の numClasses と食い違う場合は警告
- [x] `AppConfig` / `.config` 読み込みに `resumeFrom` / `saveLastEvery` を追加
      (併せて未対応だった `model_name` にも対応。チェックポイント名を決めるため)
- [x] 再開後に tracker が旧ベストを保持し、悪い指標で `best.pt` を上書きしないこと
      → `best_checkpoint_test`(引き継ぐ場合 0 回 / 引き継がない場合 1 回の対比で検証)
- [x] resume シナリオのテスト
      → 分割してカバー:
        - ループ側(開始 epoch・tracker 引き継ぎ・`saveLast` 頻度)は
          `best_checkpoint_test` で `FakeCheckpointStore` を使って検証
        - 復元の連続性(実 `TorchModel` + `AdamOptimizer` で、復元後に同一ステップを
          踏むと重みが一致)は `checkpoint_rebuild_test` / `checkpoint_roundtrip_test`
      - [ ] 実ファイル・実モデルで「学習 → 中断 → 再開」を通す E2E テストは未作成
            (実データセットが要るため。上記2つの組み合わせで実質カバーしている)

## 実装後の挙動まとめ

### 再開元の決定（`main.cpp`）

1. `.config` の `resume_from` が指定 → その `.pt` から再開
2. 未指定でも `<output_dir>/<model_name>_last.pt` が存在 → 自動で再開
3. どちらもなし → cold start

### `.config` のノブ

```
# model_name = Segnet          # チェックポイント名。未指定なら "model"
# resume_from = .../model_last.pt   # 空なら _last.pt を自動検出
save_last_every = 0            # 0 = 毎エポック。最終エポックは常に保存
```

### 保存タイミング

| | タイミング | 用途 |
|---|---|---|
| `<name>_best.pt` | validation mIoU がベスト更新したエポック | 推論・デプロイ |
| `<name>_last.pt` | `save_last_every` ごと + 最終エポック | 中断・再開 |

## 検討事項(未決)

- **`CheckpointMeta` に `MetricMode` を持たせるか**。持たせると「保存時の監視方向」と
  再開時の tracker 設定の不一致を検出できる。持たせないなら合成層が config から与える。
- **破損 / 不整合チェックポイント時の方針**。cold start にフォールバックするか、明示エラーで中断するか。
  - モデルグラフのフィンガープリント検証は実装済み(`modelGraphFingerprint` を archive の
    `model_graph_fingerprint` に書き、`TorchCheckpointStore::loadFrom` で照合。不一致は
    `runtime_error`、旧 .pt は警告のみ)。現状は「明示エラーで中断」。cold start
    フォールバックにするかは resume 配線時に判断。
  - optimizer 種別名の検証は実装済み(`optimizer_type` を archive に書き、
    `readCheckpointArchive` で照合。不一致は `runtime_error`、旧 .pt は警告のみ)。
  - `format_version` は「現行超=読めない / 現行未満=version 別読み分け(現在 v1 のみ)」で分岐。
- **RNG 状態**。実装済み。`rng_state_cpu` を checkpoint に保存し、`CheckpointModelLoader::load`
  (=再開経路)でグローバル CPU 生成器へ復元する。現状の学習ループには乱数消費が無いため
  実効差はまだ出ないが、シャッフル/dropout/データ拡張が入ったときに再開が非再現になるのを防ぐ。
  詳細: `docs/checkpoint-rebuild.md` §5.9。GPU 生成器は未対応。
- **LR スケジューラ状態**。スケジューラ機能そのものが未実装。実装時に checkpoint へ足す。
- **出力ディレクトリ運用**。resume で同じ run に追記すると best/last が混ざる。新ディレクトリを切ると
  「どの run の続きか」の追跡が要る。
- **総エポック数 ≤ 保存済み epoch** のとき(やることなし)の挙動。警告して終了。

## 関連

- checkpoint-store-refactor.md — `ICheckpointStore` / `TorchCheckpointStore` の切り出し
- optimizer-state-save.md — `IModel` / `IOptimizer` の `writeTo` / `readFrom`、archive 統一
- `tests/checkpoint_roundtrip_test.cpp` — save→load の復元検証(resume の土台。store 層は完了)
- validation.md — `IModelEvaluator` による mIoU 監視(resume 時の best 指標の出所)
