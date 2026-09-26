# prefetchDataのissue

## 構成図

```mermaid
TorchModelTrainer ──▶ IDatasetRepository        ← 変更なし(Trainerはここまでしか知らない)
                            ▲
                 TorchDataLoaderAdapter          ← 新規。IDatasetRepositoryを実装
                            │ 内部で使う
                 TorchSampleDataset              ← 新規。libtorchのDatasetを継承
                            │ 呼ぶ
                      ISampleSource              ← 新規ポート: index → 1サンプル
                            ▲
                     VocSampleSource             ← 新規。VOC読み込みの実体
```

上の構成図は当初案(libtorch の DataLoader を使う方式)。実装は、これとは別に、`PreFetchDatasetRepository`(`IDatasetRepository` の Decorator。ワーカースレッド1本、バッファ1枠)として行った。

---

## 追記(2026-09-26): データ読み込みがボトルネックになっている — 計測結果と対応方針

### 背景

学習中に GPU の利用率が途切れる現象があり、原因を切り分けるため、処理時間の計測機能を実装した。

- `TimedDatasetRepository`(`IDatasetRepository` の Decorator)、`ScopedTimer`(RAII)、`BufferTimeRecorder` / `NullTimeRecorder`(`ITimeRecorder` 実装)、`CoutTimeReportWriter`(名前ごとの集計を標準出力へ)
- `.config` の `enable_time_measurement = true` で有効化する。学習終了時(`runTraining()` を抜けるとき)に集計表が出る
- `PreFetch` の内側と外側を包み、`*.produce`(ワーカーが1バッチを作る時間)と `*.wait`(学習ループが待った時間)を測る

### 計測結果

条件: 実データ(PASCAL VOC 形式、学習 266 枚 / 検証 58 枚、実画像は 1200×1920 の JPEG で約 190KB)、`batch_size=1`、入力 256×256、1エポック。devcontainer(RTX 5070 Ti、16コア、`/workspaces` は 9p マウント)。全体で約 1分45秒。

| 名前 | 回数 | 合計(ms) | 平均(ms) |
|---|---|---|---|
| train.produce_getNextBatch | 267 | 71,540 | 267.9 |
| train.wait_hasNext | 267 | 65,427 | 245.0 |
| train.wait_getNextBatch | 266 | 5 | 0.019 |
| val.produce_getNextBatch | 59 | 15,746 | 266.9 |
| val.wait_hasNext | 59 | 14,423 | 244.5 |
| produce_hasNext(学習・検証とも) | 約 268 / 60 | ほぼ 0 | ほぼ 0 |

- 同条件の2回目: `train.produce_getNextBatch` 平均 265.0 ms、`train.wait_hasNext` 平均 242.2 ms(再現した)
- スレッドごとの CPU 使用率(`/proc/<pid>/task/*/stat` を 10 秒間隔で2回計測): 1本のスレッドが約 94%(ワーカーと推定)、メインスレッドは約 6〜7%、プロセス全体で約 120%(16コア = 1600% に対して約 7.5%)。`time` の結果は `real` 1m45s、`user` 2m0s、`sys` 5.5s

### わかったこと / 推測

わかったこと(計測で確認済み)

- 待ちは `PreFetchDatasetRepository::hasNext()` で発生している(内部の `condition_variable::wait`)。`getNextBatch()` はほぼ待たない
- 学習ループは、全体(約 105 秒)のうち、約 80 秒(約 76%)をデータの到着待ちに使っている
- ワーカーが 1バッチを作る時間(約 268 ms)は、1回の計算時間(約 23 ms と推定。生産時間 − 待ち時間)の約 12 倍
- ワーカーは 1コアをほぼ使い切っており、残りのコアは使われていない

推測(未確認)

- 268 ms の内訳は未計測。1200×1920 のデコード、フル解像度でのカラー → クラス ID 変換、リサイズ、正規化のどれが支配的かは不明
- CPU 処理が支配的な可能性が高い(`user` が実時間と同程度)が、9p の I/O の寄与は分離できていない

### やること

順序: 内訳の計測 → 設計の決定 → 並列化 → 調整。ワーカー数を可変にすることは、並列化の設計が決まってからの作業になる(現在の `PreFetch` は、状態を持つ内側のリポジトリを1本のワーカーが順に呼ぶ設計のため、数を増やすだけでは動かない)。

- [ ] 段階2の計測: 268 ms の内訳を測る
  - `ISegmentationData` の Decorator(`getImage` と `getMask` を別々に測る)
  - `IImagePreprocessor` の Decorator(画像用とマスク用は別インスタンスなので、名前で区別できる)
  - `IImageDecoder` の Decorator(画像の JPEG とマスクの PNG が同じインスタンスを通るため、拡張子で名前を分ける)
  - 継ぎ目のない箇所(`ColorMaskLabelConverter` は具象クラスを値で保持、`ImageNormalizer::normalize` は static 関数)は、差分で求める(例: `getMask` − PNG デコード、`getNextBatch` − サンプルごとの処理の合計)。差分で足りなければ、`ILabelConverter` / `IImageNormalizer` のようなインターフェースを切り出す
  - 処理クラスに `ITimeRecorder` を持たせず、Decorator で外側から包む。`DatasetRepositoryFactory` に `ITimeRecorder` を渡し、`IImageDecoder` は `TrainingApp.cpp` で、ファクトリに渡す前に包む
- [ ] I/O の寄与を切り分ける: 同じデータをコンテナ内のローカル領域(`/tmp` など)にコピーして、`/workspaces`(9p)と比較する
- [ ] 内訳に基づいて、遅い処理そのものを改善できるか検討する(アルゴリズムの見直し、事前リサイズ、`cv::IMREAD_REDUCED_COLOR_2` による縮小デコードなど)
- [ ] 並列化の設計を決める(下の「未決定事項」)
- [ ] 決めた設計に、ワーカー数のパラメータ(`.config` の `num_workers` など。既定 1 = 現状の動作)を持たせる
- [ ] ワーカー数を変えながら計測機能で確認し、調整する
- [ ] 単体テストを追加する(`BufferTimeRecorder` を複数スレッドから呼んでも壊れない、`CoutTimeReportWriter` の集計値、`TimedDatasetRepository` が呼び出しを素通しする)

### 決定事項

- 計測は Decorator で処理クラスの外側に置く(処理クラスを `ITimeRecorder` に依存させない)
- 計測のオン・オフは `.config`(`enable_time_measurement`)で切り替え、オフのときは `NullTimeRecorder`(Null Object)を注入する
- ワーカー数は固定値にせず、設定値にする。「生産時間 ÷ 計算時間 ≒ 12」は、今回の条件(`batch_size=1`、256×256、この環境)での目安にすぎない。バッチサイズやモデルを変えると、適切な数も変わる

### 未決定事項

- 並列化の方式
  - 案A: 1バッチ内のサンプルごとの処理を並列にする(`batch_size` が並列度の上限になる。`batch_size=1` では効果がない)
  - 案B: 複数のワーカーが別々のバッチを作る(PyTorch の `num_workers` 方式。「何番目のバッチ」と指定すれば作れる、状態を持たない形と、順序付きのキューが必要。`IDatasetRepository` の設計の見直しを伴う)
  - 案C: libtorch の DataLoader(`workers(N)`)を使う(上の当初の構成図の方向)
  - 案D: 1サンプルの処理自体を速くする(内訳の計測結果しだい。並列化より先に検討する)
- 先読みバッファの深さ(現状 1 枠)を増やすか。生産が計算より遅い間は、増やしても効果がない
- ワーカーと、OpenCV / libtorch が内部に持つスレッドプールの、CPU の取り合い(オーバーサブスクリプション)への対処
- 同時に処理中のバッチ数に応じたメモリ使用量(devcontainer は約 7GB)
- 完了条件の数値(`train.wait_hasNext` の合計を、エポック全体の何%以下にするか)

### 関連(別課題)

- `IDatasetRepositoryFactory::create` の戻り値を `unique_ptr` にして、Decorator の連鎖の所有権を実態に合わせる(現状は `shared_ptr` で統一されている。`ITimeRecorder` は複数の Decorator で共有されるため、`shared_ptr` のままでよい)
- `ConfigReader.cpp` の `if / else if` の連なりに、設定を追加する人が集中すると、ブランチ間でコンフリクトしやすい。セクションごとの分割を検討する

### 影響範囲

- 段階2: 新規 Decorator(`ISegmentationData` / `IImagePreprocessor` / `IImageDecoder` 用)、`DatasetRepositoryFactory`(`ITimeRecorder` を受け取る)、`TrainingApp.cpp`
- 並列化: `PreFetchDatasetRepository` またはその代替、`IDatasetRepository` の契約、`AppConfig.hpp` / `ConfigReader.cpp` / `.config`(`num_workers`)

### 完了条件

- 内訳が計測され、支配的な処理が特定されている
- 並列化の方式が決まり、`num_workers` を設定で変えられる
- 実データで、`train.wait_hasNext` の合計が、目標(未決定事項に挙げた数値)を下回る