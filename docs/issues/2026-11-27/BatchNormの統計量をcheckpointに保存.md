# fix:checkpoint に BatchNorm の統計量(running_mean / running_var)を保存・復元する

## 問題点

checkpoint から読み直したモデルは、BatchNorm の統計量が初期値(平均 0・分散 1)になっている。そのため eval モードの出力が崩れる。

- 例: SegNet 10 層・Dice の `<model_id>_best.pt`(学習時の val mIoU 0.79)を読み直して同じ val を評価すると、mIoU が **0.00**(全画素が背景)になる
- 推論(`docs/issues/2026-11-27/推論CLI.md`)で、学習済みのモデルが使えない
- **学習の再開でも同じことが起きている**。再開した直後のエポックは、統計量が初期値から学習し直しになる(momentum によっては数バッチで戻るが、再開前と同じ状態からは続かない)

### 原因

`TorchModel::writeTo` / `readFrom`(`src/training/infrastructure/torchModel/TorchModel.cpp`)は `parameters()` だけを読み書きしている。

- BatchNorm の `running_mean` / `running_var` / `num_batches_tracked` は parameter ではなく **buffer** なので、`parameters()` に入らない
- 学習中の評価は、メモリ上の統計量をそのまま使うので問題が見えなかった。読み直したときだけ崩れる

### 確認したこと(tmp/inference-demo ブランチ)

- checkpoint の parameter 38 個は、形・値ともに正しく読めている
- train 画像を学習と同じ条件(拡張あり・momentum 0.5)で 1 周 train モードで流して統計量を推定し直すと、学習と同じ評価器で val の mIoU が **0.7931**(学習時 0.7926)に戻った。崩れる原因は統計量だけ

## 方針

**層ごとに buffer を返せるようにし、`TorchModel` が parameter と同じように checkpoint へ書く・読む。**

- buffer を持つ層は今のところ BatchNorm だけ。ほかの層は変えない
- buffer のない古い checkpoint も読めるようにする(警告を出して統計量は初期値のまま続ける)。既存の `_last.pt` からの再開を壊さない
- ついでに、読み込むときに形が一致するかを確かめる。いまの `copy_` はブロードキャストが効くので、形が違っても黙って通る

### この変更で変わること・変わらないこと

| | 内容 |
|---|---|
| 変わる | 新しく保存した checkpoint を読み直すと、eval モードの出力が保存前と同じになる(推論・再開の両方) |
| 変わる | parameter / buffer の形が checkpoint とモデルで違うと、読み込みが例外で止まる(いままでは黙って通っていた) |
| 変わらない | checkpoint のファイル名・`CheckpointArchiveIO` のレイアウト(`model` の中のキーが増えるだけ)、fingerprint、optimizer の状態 |
| 変わらない | **既存の checkpoint には統計量が入っていない**。直すには学習し直す |

## 設計

### インターフェース(adapters)

`src/training/adapters/interfaces/ILayer.hpp` に、既定の実装つきで追加する。

```cpp
// 学習で更新されるが勾配を持たない状態(BatchNorm の running_mean など)。checkpoint に保存する。
// 持たない層は空を返す(既定)。
virtual std::vector<at::Tensor> buffers() const { return {}; }
```

### 実装(infrastructure)

| ファイル | 変更 |
|---|---|
| `torchFunc/TorchBatchNormLayer.{hpp,cpp}` | `buffers()` を override し、`_module->buffers()`(running_mean, running_var, num_batches_tracked)を返す |
| `torchModel/TorchModel.{hpp,cpp}` | `buffers()`: 全層の `buffers()` を実行順につなげる(`parameters()` と同じ順序の決め方) |
| `torchModel/TorchModel.cpp` の `writeTo` | `model_buffer_count` と `model_buffer_<i>` を書く |
| `torchModel/TorchModel.cpp` の `readFrom` | 下の手順で読む |

`readFrom` の手順:

1. parameter: いまどおり読む。`copy_` の前に `sizes()` が一致するかを確かめ、違えば `std::runtime_error`(何番目の parameter か、両方の形をメッセージに入れる)
2. buffer: `try_read("model_buffer_count")`
    - キーがない(古い checkpoint) → `[warn] checkpoint に BatchNorm の統計量がありません(旧形式)。eval モードの出力は保存時と一致しません` を出して終わる
    - 数がモデルと違う → `std::runtime_error`
    - あれば 1 つずつ形を確かめて `copy_`(device はモデル側に合わせる。parameter と同じ)

- `num_batches_tracked` は int64。`copy_` で型ごとそのまま入る
- `TorchCheckpointStore::loadFrom`・`CheckpointModelLoader::load` はどちらも `IModel::readFrom` を通るので、呼び出し側は変えない

## テスト

- `checkpoint_roundtrip_test` に BatchNorm を含むケースを追加(いまは BN の eval 出力を確かめるケースがない)
    - BN を含むモデルを train モードで数回 forward し、統計量を初期値から動かす → 保存 → 新しいモデルに読む → **eval モード**で同じ入力に同じ出力を返す
    - buffer のキーを書かない(古い形式の)checkpoint も、例外なしで読める
    - parameter の形が違う checkpoint(例: チャンネル数だけ違うグラフで保存したもの)は例外になる
- `checkpoint_rebuild_test`(`CheckpointModelLoader` 経由)でも、BN を含むモデルの eval 出力が一致することを確かめる
- 既存のテスト(`best_checkpoint_test`、`optimizer_resume_options_test` など)がそのまま通る

## 完了条件

- 新しく学習して保存した `<model_id>_best.pt` を読み直し、同じ val を評価すると、学習時の val mIoU と一致する(推論 CLI でも同じ)
- 再開した直後のエポックの評価が、再開前の最後のエポックから連続した値になる
- 古い checkpoint からの再開が、警告つきでこれまでどおり動く
- 既存のテストがそのまま通る

## 補足: BatchNorm の momentum

保存とは別の話として、momentum 0.5(いまのモデル文書の設定)だと、eval で使う統計量が最後の 1〜2 バッチでほぼ決まる。今回、統計量を推定し直す条件によって mIoU が 0.23〜0.79 と大きく揺れたのはこのため。評価を安定させたいなら、次の実験からは 0.1(PyTorch の既定値)程度にするのがよい。
