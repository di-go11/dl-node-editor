# feat: 学習チェックポイント（モデル重み + Optimizer 状態）の保存・復元機能

## 背景
`IModelStore` によるモデル重みの保存機能を実装中。現状は以下の課題がある。

1. `TorchModelStore::save` が `dynamic_cast<const TorchModel&>` に依存しており、
   シリアライズの責務が Store 側に漏れている。
2. モデル重みだけでは学習を途中から正確に再開できない。Optimizer の内部状態が必要。
   - SGD + momentum: 各パラメータの運動量バッファ
   - Adam / AdamW: `exp_avg`（1次モーメント）、`exp_avg_sq`（2次モーメント）、`step`
   - （将来）LR スケジューラの進行状態
3. `IOptimizer`（`src/training/adapters/interfaces/IOptimizer.hpp`）は
   `resetGradients()` / `updateParmeters()` のみで、状態を出し入れする口がない。

## 設計方針: archive ベースで統一

責務を2つに分離する。

- **シリアライズ（中身を書く/読む）**: 対象オブジェクト本人が担当
- **永続化ポリシー（保存先・形式・タイミング）**: Store が担当

### インタフェース変更
- `IModel` に archive の読み書き口を追加
  - `virtual void writeTo(torch::serialize::OutputArchive&) const = 0;`
  - `virtual void readFrom(torch::serialize::InputArchive&) = 0;`
  - （libtorch 型を adapters 層に出したくない場合は薄い抽象を挟む）
  - これにより `TorchModelStore` の `dynamic_cast` を除去
- `IOptimizer` に同様の save/load を追加（`save(path)` ではなく archive ベース）
  - `virtual void writeTo(torch::serialize::OutputArchive&) const = 0;`
  - `virtual void readFrom(torch::serialize::InputArchive&) = 0;`
  - infrastructure 実装（`AdamOptimizer` / `AdamWOptimizer` / `SGDOptimizer`）は
    libtorch の `torch::optim::Optimizer::save/load(serialize::*Archive&)` に委譲

### チェックポイント
- 1 つの `OutputArchive` に model 重み + optimizer 状態 + epoch/step をまとめて書き、
  1 ファイルとして保存できるようにする
- 推論用途（重みのみ）と学習再開用途（フル）を呼び分けられる API にする

## タスク
- [x] `IModel` に `writeTo` / `readFrom` を追加、`TorchModel` で実装
- [x] `TorchModelStore` から `dynamic_cast` を除去し IModel 経由に変更
- [x] `IOptimizer` に `writeTo` / `readFrom` を追加、各 Optimizer 実装で libtorch に委譲
      （adapters 層に `torch::serialize::*Archive` を出さないため `ICheckpointWriter/Reader`
       の不透明ハンドルを噛ませ、infrastructure の `TorchCheckpointArchive` で libtorch に変換）
- [x] チェックポイント（model + optimizer + 進捗メタ）を 1 archive にまとめる Store
      （`TorchCheckpointStore::saveBest` / 別 issue: checkpoint-store-refactor.md）
- [x] 重み側のパラメータは名前付きキー（`model_param_N` + count）で書き出し
      （Optimizer 側は libtorch の `Optimizer::save/load` に委譲）
- [ ] テスト（save → 復元後に重み・`exp_avg` 等が一致 / 数ステップの連続性）
  - 保存 → 復元後に重み・`exp_avg` 等が一致すること
  - 数ステップ学習して挙動が連続すること
  - 構造復元（ModelGraph）と重みロードの結合

## 依存 / 順序
`IModelStore` の重み保存機能（ModelSave ブランチ）をベースに進める。

## アーキテクチャ上の注意
依存方向 entities → application → adapters → infrastructure を維持。
インタフェースは adapters/application 層、libtorch 依存は infrastructure 層に閉じる。
`torch::serialize::*Archive` を adapters 層に露出させたくない場合は、
プロジェクト独自の薄い archive 抽象を用意して infrastructure 側で libtorch に変換する。
