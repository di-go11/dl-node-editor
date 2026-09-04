# feat: 処理の GPU 化（デバイス対応）

## 背景

`ai_engine_app` は現状すべての計算を CPU で実行している（テンソルが一度も
`.to(device)` されていない）。実データ 266 枚・128×128・Conv 1 層で
**約 92 秒/epoch**（`fix/evaluator-ignore-index` での実測）。SegNet 等の実
アーキテクチャを入れて多数 epoch 回す段階では CPU では現実的でない。

libtorch は CUDA ビルド済み（`libtorch_cuda.so` 等が同梱）、デプロイ先は
**ai-engine コンテナが動く自前サーバー（GPU あり）**。エンドユーザー端末では
ない。

関連の前提整理は `docs/checkpoint-rebuild.md` / `docs/issues/training-resume.md`
（checkpoint・resume は実装済み。`RestoredCheckpoint` で構造ごと再構築できる）。

## 方針: GPU 前提。ただし CPU パスは消さない

| 対象 | 方針 |
|---|---|
| `ai_engine_app`（実学習） | **デフォルト `cuda:0`。config が CUDA 要求で `torch::cuda::is_available()` が false なら起動時に明示エラー**（CPU へ暗黙フォールバックしない） |
| device の指定 | `.config` に `device = cpu \| cuda:N`（デフォルト `cuda:0`） |
| ユニットテスト | **CPU のまま**。数値ロジックの検証でありスループットは無関係。GPU 必須にすると CI に GPU ランナーが要る |
| checkpoint の device 跨ぎテスト | CUDA があれば実行、無ければ skip |

理由:

- 研究の試行錯誤で CPU 学習に落ちるのは事実上使い物にならない → 「config が
  `cuda` なのに使えない」は**黙って CPU で回さず落とす**のが正しい
- GPU 必須にしても「テンソルをどこかへ置く」処理（`.to(device)`）は結局書く。
  `device` を固定するか設定可能にするかの差は enum 1 個ぶんで、消すメリットが薄い
- CPU パスを残すと GPU 無しマシンでの小規模デバッグ、checkpoint の CPU↔GPU
  両方向テストができる

## スコープを 2 段に分ける

`gpu-support` の旧版は GPU 化を「gRPC 層（Rust↔C++）の立ち上げ + `GetCapabilities`
RPC + Rust ポリシーエンジン」と束ねていた。gRPC 層はまだ 1 行も無いため、
まず C++ 内で完結する Phase 1 をやる。

---

## Phase 1: C++ 内のデバイス抽象（このブランチ `feature/gpu-support`）

### 1. `Device` entity

`entities/domain-objects/Device.hpp`（libtorch 非依存）:

```cpp
enum class DeviceKind { Cpu, Cuda };

struct Device
{
    DeviceKind kind = DeviceKind::Cuda;
    int index = 0; // Cuda のときのみ意味を持つ
};
```

`deviceToString` / `parseDevice("cuda:0")` の純粋関数も同 entity に。
`torch::Device` 型は **infrastructure に閉じる**。

### 2. `.config` / `AppConfig`

- `AppConfig` に `Device device;`（デフォルト `cuda:0`）
- `ConfigReader` に `device` キー（`cpu` / `cuda` / `cuda:N`）。`ModelGraph` の
  ような複雑さは無いのでその場でパース

### 3. infrastructure でのデバイス配置

- `Device` → `torch::Device` 変換ヘルパ（`infrastructure/torchFunc` あたり）
- `TorchModelFactory::create(graph, device)` — 生成した各層のパラメータを
  `.to(device)`。`TorchLayerBuilder` にも device を通す
- `TorchModelTrainer` / `TorchModelEvaluator` — `BatchTensorConverter` が
  作った `input` / `target` を `.to(device)` してから forward へ
- `TorchOptimizerFactory` — optimizer は「デバイス上の `parameters()`」を
  受け取れば良いので、モデルを先に配置してから構築する順序を守るだけ

### 4. 起動時チェック

`main.cpp`（将来は合成層）で、`device.kind == Cuda && !torch::cuda::is_available()`
なら `runtime_error`。メッセージに「libtorch は CUDA ビルドか」「ドライバは見えるか」
のヒントを添える。

### 5. checkpoint の device 跨ぎロード

`CheckpointArchiveIO::readCheckpointArchive` / `TorchModel::readFrom` で、
archive から読んだテンソルを**現行モデルの device に合わせてから** `copy_` する
（今は同一 device 前提。CPU で保存 → GPU で再開、が壊れる）。
`rng_state_cpu` は CPU 生成器の状態なので device 非依存、変更不要。

### Phase 1 のテスト

- `device_config_test`: `parseDevice` / `deviceToString` の往復、不正値のエラー
- `training_smoke_test` を拡張: `SMOKE_DEVICE`（CMake から注入、既定 cpu）で
  device を切り替え。CUDA が無ければ cpu のまま実行
- checkpoint device 跨ぎ: CPU 保存 → `Device{Cuda,0}` で `CheckpointModelLoader`
  → 重み一致・追加ステップ連続（`if (torch::cuda::is_available())` で囲む）
- 既存の CPU テストは無改修で通ること

### Phase 1 のタスク

- [ ] `Device` entity（enum + index、`parseDevice` / `deviceToString`）
- [ ] `AppConfig` / `ConfigReader` に `device`
- [ ] `Device` → `torch::Device` 変換（infrastructure）
- [ ] `IModelFactory` / `TorchModelFactory` / `TorchLayerBuilder` に device を通す
- [ ] `TorchModelTrainer` / `TorchModelEvaluator` で入力・ターゲットを `.to(device)`
- [ ] `main.cpp`: device 決定 → 起動時 CUDA チェック → 配線
- [ ] checkpoint の device 跨ぎロード（読んだテンソルを現行 device へ）
- [ ] テスト（上記）
- [ ] 実データ 266 枚で GPU 実行し、CPU 版と loss が概ね一致・高速化を確認

---

## Phase 2: gRPC 層と Rust ポリシー（別 issue / API 層の着手とセット・保留）

gRPC 層（Rust↔C++）が存在しないため、それを立てるタイミングで行う。

### C++ — `GetCapabilities` RPC

- `cuda_available`（`torch::cuda::is_available()`）
- `device_count`（`torch::cuda::device_count()`）
- ビルド時 CUDA / cuDNN バージョン
- 各デバイスの名前・compute capability・VRAM

### Rust — ポリシー / バリデーション層

- 「GPU 指定されたが `cuda_available=false`」を弾く
- device index の存在チェック
- ユーザー向けエラーメッセージ生成
- 起動時に capability を取得しキャッシュ
- （任意）接続前の軽量プリフライト。`nvidia-smi` パースは壊れやすいので補助に留める

### Phase 2 のタスク

- [ ] `.proto` 定義（gRPC 層の最初の一歩を兼ねる）
- [ ] C++: `GetCapabilities` RPC 実装
- [ ] Rust: capability 取得・キャッシュ
- [ ] Rust: device 指定のバリデーションとエラーメッセージ
- [ ] Phase 1 の「起動時 CUDA チェック」を、Rust 側の事前バリデーションに寄せる

---

## GPU 化の後回し理由（`学習パイプライン改善issue.md` より）

- `batch_size=1` のままでは転送オーバーヘッドの割に恩恵が薄い。バッチ化と
  セットで効く（バッチ化タスクは別 issue、`VocDatasetRepository` は
  `_batchSize` 対応済みで確認待ち）
- 実アーキテクチャ（SegNet）未実装。現状の Conv 1 層は表現力不足で
  `val_mIoU` が横ばい（`fix/evaluator-ignore-index` で確認）。GPU で速くしても
  出るモデルが無い

→ 現実的な順序は **バッチ化仕上げ → SegNet 実装 → GPU 化** だが、Phase 1 の
device 抽象は独立して入れられる（配線だけで挙動は変わらない）。

## アーキテクチャ上の注意

依存方向 entities → application → adapters → infrastructure を維持。
`torch::Device` などの libtorch 型は infrastructure 層に閉じ、
上位層へは `Device`（enum + index、entities）で渡す。
`clean-arch-lint` で最終確認。

## 関連

- `docs/checkpoint-rebuild.md` — `CheckpointModelLoader` / `CheckpointArchiveIO`
  （device 跨ぎロードを足す先）
- `docs/issues/training-resume.md` — resume 配線（GPU でも同じ経路を通る）
- `docs/issues/学習パイプライン改善issue.md` — バッチ化 → 重み保存 → GPU 化の親 issue
- `tests/training_smoke_test.cpp` — device 切替を足す先
