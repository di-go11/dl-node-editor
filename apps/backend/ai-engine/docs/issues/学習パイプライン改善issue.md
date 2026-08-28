# 学習パイプライン性能・機能改善 issue下書き

対応順: バッチ化 → 重み保存/読み込み → GPU化

---

## 【親issue】学習パイプラインの性能・機能改善(バッチ化 → 重み保存/読み込み → GPU化)

### 概要

実データ(PASCAL VOC形式、266枚)で学習ループが完走することを確認済み(`e4e3e21`)。しかし現状は以下の制約がある。

- `batch_size=1`固定でバッチ化されていない(`BatchTensorConverter`自体は複数枚をまとめる実装だが、画像解像度がバラバラなため`batch_size>1`では壊れる)
- 学習済み重み・モデル構造を保存/再読み込みする手段がない
- libtorchはCUDAビルドだが、Tensorが一度もGPUへ転送されておらず全計算がCPUで実行されている

以下の順で対応する。後段のフェーズほど前段の実装に依存するため、この順序で進める。

1. [ ] バッチ化(#issue番号)
2. [ ] 重み保存/読み込み(#issue番号)
3. [ ] GPU化(#issue番号)

### 優先度の理由

- GPU化を先にやっても`batch_size=1`のままでは転送オーバーヘッドの割に恩恵が薄く、バッチ化とセットで初めて効果が出る
- 重み保存/読み込みとGPU化は、どちらもモデルの状態管理(`TorchModel`のパラメータの持ち方)に触れるため、バッチ化で入出力の形が固まってから着手した方が手戻りが少ない

---

## issue 1: バッチ化 — 複数画像をまとめて学習できるようにする

### 背景

`BatchTensorConverter::resolveShape`は複数枚の`ImageData`を`[N,C,H,W]`の1つのTensorにまとめる実装になっているが、実際のVOCデータセットは画像ごとに解像度がバラバラなため、`batch_size>1`にすると「全画像が同じshapeであること」の前提が崩れて例外になる(またはそもそも積めない)。

### やること

- [ ] `dataset/train`内の画像解像度が実際にバラバラかを確認する
- [ ] 学習画像・アノテーションマスクを固定サイズにリサイズする処理を追加する(新規`ImageResizer`など)
  - 学習画像側は`INTER_LINEAR`等、マスク側はクラスIDを壊さないよう`INTER_NEAREST`で補間方法を分ける
- [ ] リサイズ後のサイズを`.config`(`AppConfig`)で指定できるようにする(例: `input_width`/`input_height`)
- [ ] `VocDatasetRepository::getNextBatch()`にdecode→resize→normalizeの順で組み込む
- [ ] `.config`の`batch_size`を2以上にして実データで動作確認する
- [ ] `MseLoss`等がバッチ次元(N)に対して正しく平均を取れているか確認する
- [ ] `image_pipeline_smoke_test`にバッチ化のテストケースを追加する

### 影響範囲

- 新規: `ImageResizer.hpp/.cpp`
- `VocDatasetRepository.cpp`
- `AppConfig.hpp` / `ConfigReader.cpp` / `.config`
- `tests/image_pipeline_smoke_test.cpp`

### 完了条件

- `batch_size`を2以上にした状態で実データ266枚の学習ループがエラーなく完走する

---

## issue 2: 重み保存/読み込みの実装

### 背景

学習済みモデルの重み・構造を保存/再読み込みする手段が現状ない。

### やること

- [ ] 保存対象を整理する(要相談):
  - 学習済みパラメータ(重み)
  - モデル構造(`ModelGraph`。現状`main.cpp`内にハードコード)
- [ ] `application/interfaces`に`IModelPersistence`(仮)ポートを設計する(`save(path, model)` / `load(path) -> model`)
- [ ] `infrastructure`に`TorchModelPersistence`実装を追加する(libtorchの`torch::save`/`torch::load`を利用)
- [ ] `TorchModel`/`ILayer`実装が保持するlibtorchの`nn::Module`から重みを取得・復元できるようアクセサを追加する
- [ ] モデル構造(`ModelGraph`)のシリアライズ形式を決定する
  - 案A: 当面は重みのみ保存し、構造は毎回コードで組み立てる運用にする(スコープを絞る)
  - 案B: JSON等でモデル構造もファイル化する(将来のGUI連携を見据えるなら必要になる)
- [ ] `main.cpp`に保存/読み込みのタイミングを組み込む(学習後保存、起動時に既存重みがあればロード等)

### 影響範囲

- 新規: `IModelPersistence.hpp`
- 新規: `TorchModelPersistence.hpp/.cpp`
- `TorchModel.hpp/.cpp`
- `main.cpp`

### 完了条件

- 学習後に重みをファイルに保存できる
- 保存した重みを読み込んで、学習を再開または推論に使える

### 備考

モデル構造の保存フォーマット(案Aか案Bか)は着手前に方針を決める必要がある。

---

## issue 3: GPU化 — libtorchの計算をCUDAデバイスで実行する

### 背景

libtorchはCUDAビルド(`2.13.0+cu126`)で`nvidia-smi`でもGPUが認識されているが、コード上どこにも`.to(torch::kCUDA)`が呼ばれておらず、全てのTensor計算がデフォルトのCPUデバイス上で実行されている。バッチ化により恩恵が最大化される想定のため、バッチ化完了後に着手する。

### やること

- [ ] `AppConfig`/`.config`に`device`設定を追加する(例: `device = cuda` / `cpu`)
- [ ] `torch::cuda::is_available()`によるフォールバック処理を追加する(GPU非搭載環境でも動くように)
- [ ] `TorchModel`構築後、モデルパラメータを`to(device)`でGPUへ転送する
- [ ] Optimizer構築は、パラメータを`to(device)`した**後**に行う(順序を守る)
- [ ] `TorchModelTrainer`で入力/ターゲットTensorをforward直前に`to(device)`する
- [ ] 実データで学習速度が改善していることを確認する(`nvidia-smi`でGPUメモリ使用量が増えることも確認)

### 影響範囲

- `AppConfig.hpp` / `ConfigReader.cpp` / `.config`
- `TorchModel.hpp/.cpp`
- `TorchModelTrainer.cpp`
- `main.cpp`

### 完了条件

- `device = cuda`設定時に`nvidia-smi`上でGPUメモリ使用量が増加し、CPU実行時より学習が高速化する
- GPU非搭載環境でも`device = cpu`または自動フォールバックで従来通り動作する
