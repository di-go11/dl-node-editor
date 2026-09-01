# feat: validation（検証）機能

## 背景
現在の学習ループ（`TrainModelUsecase`）は train のみで、検証データでの評価がない。
loss は `std::cout` に出るだけで、指標の記録も過学習の検知もできない。

## 現状コードの課題

`IModel::train(prediction, target, loss, optimizer)` が
**forward + loss + backward + optimizer.step を1メソッドに内包**している
（`TorchModel::train`）。validation では以下が必要なため、このままでは流用できない:

- backward / optimizer.step を **しない**
- `torch::NoGradGuard`（勾配計算オフ、メモリ・速度）
- eval モード（BatchNorm の統計量固定など。将来 Dropout 追加時も）

### 必要なリファクタ
- `IModel` に推論経路を分離
  - `forward(input) -> output`（勾配なし・eval モードで呼べる）
  - もしくは `evaluate(input, target, loss) -> lossValue`
- train 経路は既存を維持（または forward を内部で再利用）
- eval / train モード切替 API（`setEval()` / `setTrain()` 相当）

## データセット側
- `IDatasetRepository` を train / validation で別インスタンスとして扱う
  （インタフェースは現状のままで、DI で 2 つ渡す）
- VOC / Dummy リポジトリに split 指定を追加

## 指標
- まずは validation loss（平均）
- セグメンテーションなので mIoU / pixel accuracy を追加（別タスクでも可）
- エポックごとに集計して返す構造体（`EpochMetrics` 等）を entities に追加

## Usecase
- `TrainModelUsecase::execute` を
  「train 1 epoch → validation 1 epoch → メトリクス集約」に拡張
- validation の頻度を `TrainParam` で設定可能に（毎エポック / N エポックごと）
- ベスト更新時にチェックポイント保存（モデル保存機能と連携）

## タスク
- [ ] `IModel` の forward / eval 経路分離のリファクタ
- [ ] eval / train モード切替
- [ ] `EpochMetrics`（entities）と集計ロジック
- [ ] validation loss 実装
- [ ] mIoU / pixel accuracy 実装
- [ ] `IDatasetRepository` を train/val 2系統で DI、split 対応
- [ ] `TrainModelUsecase` に validation ループ組み込み
- [ ] ベストモデルのチェックポイント保存
- [ ] テスト（勾配が更新されないこと、メトリクス計算の正しさ）

## 依存
モデル保存機能（ModelSave）に依存。GPU 化とは独立に進められる。

## アーキテクチャ上の注意
依存方向 entities → application → adapters → infrastructure を維持。
`torch::NoGradGuard` 等 libtorch 依存は infrastructure 層に閉じる。
