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
- `TimedVocSegmentationData`(`ISegmentationData` の Decorator)で、1サンプルの `getImage` / `getMask` を測る。区間名は分割ごとに分ける(`train.segdata.*` / `val.segdata.*`)。`DatasetRepositoryFactory` が `ITimeRecorder` を受け取って組み立てる

### 計測結果(1回目: Debug ビルド)

**重要: この節の計測は、最適化なしの Debug ビルド(`CMAKE_BUILD_TYPE=Debug`。コンパイルフラグは `-g` のみで `-O` の指定なし)で行った。自前のコード(画素ごとのループなど)の速度は、Release ビルドと大きく異なる。Release での再計測は、次の節を参照。**

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
- スレッドごとの CPU 使用率(`/proc/<pid>/task/*/stat` を 10 秒間隔で2回計測): 1本のスレッドが約 94%(ワーカーと推定)、メインスレッドは約 6〜7%、プロセス全体で約 120%(16コア = 1600% に対して約 7.5%)。`time` の結果は `real` 1m45s、`user` 2m0s、`sys` 5.5s(CPU 使用率の測定は、Debug ビルドでのみ実施)

### Release ビルドでの再計測、および Debug との比較

`ISegmentationData` の Decorator を追加して `getImage` / `getMask` を別々に測り、Release ビルド(`-O3 -DNDEBUG`。`cmake -S . -B build-release -G Ninja -DCMAKE_BUILD_TYPE=Release`)と Debug ビルドで、同じ条件(学習 266 枚 / 検証 58 枚、`batch_size=1`、256×256、1エポック、同じ環境)で実行した。

学習用の平均(ms)

| 名前 | Debug | Release | 倍率 |
|---|---|---|---|
| train.produce_getNextBatch | 287.8 | 69.1 | 約 4.2 倍速い |
| train.segdata.getMask | 247.9 | 40.7 | 約 6.1 倍速い |
| train.segdata.getImage | 34.8 | 23.7 | 約 1.5 倍速い |
| 残り(リサイズ・正規化・バッチ組み立て。produce − getImage − getMask) | 約 5 | 約 4.7 | ほぼ同じ |
| train.wait_hasNext | 258.2 | 51.6 | |
| 実行全体(`real`) | 1m35.9s | 26.0s | 約 3.7 倍速い |

検証用の平均(ms)は、Debug が produce 274.1 / getImage 20.7 / getMask 248.2 / wait_hasNext 242.0、Release が produce 66.2 / getImage 20.9 / getMask 40.5 / wait_hasNext 57.0。

Release の集計表

```
Name                         Count     Total(ms)    Mean(ms)     Min(ms)     Max(ms)
train.produce_getNextBatch     267     18451.097      69.105      62.332      89.069
train.produce_hasNext          268         0.098       0.000       0.000       0.002
train.segdata.getImage         267      6328.703      23.703      18.052      36.624
train.segdata.getMask          267     10864.188      40.690      39.186      50.302
train.wait_getNextBatch        266         5.181       0.019       0.003       0.101
train.wait_hasNext             267     13769.758      51.572       0.000      79.229
val.produce_getNextBatch        59      3903.732      66.165      62.247      75.890
val.produce_hasNext             60         0.032       0.001       0.000       0.001
val.segdata.getImage            59      1231.101      20.866      17.711      25.707
val.segdata.getMask             59      2388.411      40.482      39.208      49.674
val.wait_getNextBatch           58         1.142       0.020       0.016       0.033
val.wait_hasNext                59      3365.211      57.037       0.000      74.691
```

- Debug の `train.produce_getNextBatch` は、1回目 267.9 ms、2回目 265.0 ms、3回目(`segdata` の Decorator 追加後)287.8 ms で、実行ごとに 7% 程度ばらついた

### わかったこと / 推測(Release / Debug の両方の計測を踏まえた最新)

わかったこと(計測で確認済み)

- 待ちは `PreFetchDatasetRepository::hasNext()` で発生している(内部の `condition_variable::wait`)。`getNextBatch()` はほぼ待たない(Release / Debug とも)
- Debug ビルドでは、自前のコードが最適化されておらず、`getMask` が 248 ms(生産時間の約 86%)を占めていた。Release では 40.7 ms(約 59%)。OpenCV でデコードする `getImage` は、ビルドの種類の影響が小さい(34.8 → 23.7 ms)。**Debug の値は、性能の判断に使えない**
- Release でも、学習ループはデータ待ちが多い。学習の待ち時間の合計(13.8 秒)は、生産時間の合計(18.5 秒)の約 75%
- 1回の計算時間(推定: 生産時間 − 待ち時間)は、Release で約 17.5 ms。生産時間(約 69 ms)は、その約 4 倍(Debug では約 12 倍と見積もっていた)。ワーカー数の目安は約 4 本
- 1サンプルの内訳(Release): `getMask` 約 59%、`getImage` 約 34%、リサイズ・正規化・バッチ組み立てが約 7%。リサイズ・正規化を GPU に移す案は、効果が小さい
- Debug ビルドでの CPU 使用率の測定では、ワーカーが 1コアをほぼ使い切っていた(約 94%)。Release では未測定

推測(未確認)

- `getMask`(40.7 ms)の内訳(PNG のデコードと `ColorMaskLabelConverter::convert`)は未分離。マスクの PNG は平均約 4.5KB と小さく、デコードは軽いと考えられる。一方、変換は 1200×1920 = 約 230 万画素ごとに、`RgbColor` の構築(`std::vector<uint8_t>` のヒープ確保を伴う)、`ImageData::at()` の呼び出し(別の翻訳単位の関数。LTO なしでは、Release でもインライン展開されない)、`resolveClassId` の線形探索を行うため、変換が支配的と推測している
- 9p の I/O の寄与は、分離できていない(Release でも未確認)
- 学習マシンや CI が、Debug と Release のどちらでビルドしているかは、未確認

### やること

順序: 内訳の計測 → 設計の決定 → 並列化 → 調整。ワーカー数を可変にすることは、並列化の設計が決まってからの作業になる(現在の `PreFetch` は、状態を持つ内側のリポジトリを1本のワーカーが順に呼ぶ設計のため、数を増やすだけでは動かない)。

- [ ] 学習マシンと CI(Jenkins)のビルドの種類を確認する。Debug のままなら、性能を測る・学習を走らせるビルドは Release にする
- [ ] 段階2の計測: 1サンプルの内訳を測る(`ISegmentationData` の Decorator は実装済み。残りは `getMask` の内訳と、前処理の Decorator)
  - [x] `ISegmentationData` の Decorator(`getImage` と `getMask` を別々に測る。`TimedVocSegmentationData`)
  - [ ] `getMask` の内訳(PNG のデコードと `ColorMaskLabelConverter::convert`)を分ける
  - `IImagePreprocessor` の Decorator(画像用とマスク用は別インスタンスなので、名前で区別できる)
  - `IImageDecoder` の Decorator(画像の JPEG とマスクの PNG が同じインスタンスを通るため、拡張子で名前を分ける)
  - 継ぎ目のない箇所(`ColorMaskLabelConverter` は具象クラスを値で保持、`ImageNormalizer::normalize` は static 関数)は、差分で求める(例: `getMask` − PNG デコード、`getNextBatch` − サンプルごとの処理の合計)。差分で足りなければ、`ILabelConverter` / `IImageNormalizer` のようなインターフェースを切り出す
  - 処理クラスに `ITimeRecorder` を持たせず、Decorator で外側から包む。`DatasetRepositoryFactory` に `ITimeRecorder` を渡し、`IImageDecoder` は `TrainingApp.cpp` で、ファクトリに渡す前に包む
- [ ] I/O の寄与を切り分ける: 同じデータをコンテナ内のローカル領域(`/tmp` など)にコピーして、`/workspaces`(9p)と比較する
- [ ] 内訳に基づいて、遅い処理そのものを改善できるか検討する(アルゴリズムの見直し、事前リサイズ、`cv::IMREAD_REDUCED_COLOR_2` による縮小デコードなど)
  - [ ] `ColorMaskLabelConverter` の改善(画素ごとの `RgbColor` の構築とヒープ確保をやめる、24bit の色をキーにした対応表を事前に作る、`ImageData::raw()` を直接走査する、など)。`getMask` が、Release でも生産時間の約 59% を占めるため、優先度が高い
- [ ] 並列化の設計を決める(下の「未決定事項」)
- [ ] 決めた設計に、ワーカー数のパラメータ(`.config` の `num_workers` など。既定 1 = 現状の動作)を持たせる
- [ ] ワーカー数を変えながら計測機能で確認し、調整する
- [ ] 単体テストを追加する(`BufferTimeRecorder` を複数スレッドから呼んでも壊れない、`CoutTimeReportWriter` の集計値、`TimedDatasetRepository` が呼び出しを素通しする)

### 決定事項

- 計測は Decorator で処理クラスの外側に置く(処理クラスを `ITimeRecorder` に依存させない)
- 計測のオン・オフは `.config`(`enable_time_measurement`)で切り替え、オフのときは `NullTimeRecorder`(Null Object)を注入する
- ワーカー数は固定値にせず、設定値にする。「生産時間 ÷ 計算時間」は、Release ビルドで約 4、Debug ビルドで約 12 だった(条件は `batch_size=1`、256×256、この環境)。目安にすぎず、ビルドの種類・バッチサイズ・モデルを変えると、適切な数も変わる
- 性能の計測と調整は、Release ビルド(`-O3`)で行う。Debug ビルドの値は、自前のコードが最適化されておらず、判断には使わない

### 未決定事項

- 並列化の方式
  - 案A: 1バッチ内のサンプルごとの処理を並列にする(`batch_size` が並列度の上限になる。`batch_size=1` では効果がない)
  - 案B: 複数のワーカーが別々のバッチを作る(PyTorch の `num_workers` 方式。「何番目のバッチ」と指定すれば作れる、状態を持たない形と、順序付きのキューが必要。`IDatasetRepository` の設計の見直しを伴う)
  - 案C: libtorch の DataLoader(`workers(N)`)を使う(上の当初の構成図の方向)
  - 案D: 1サンプルの処理自体を速くする(Release でも `getMask` が約 59% を占めるため有力。並列化より先に検討する)
- 先読みバッファの深さ(現状 1 枠)を増やすか。生産が計算より遅い間は、増やしても効果がない
- ワーカーと、OpenCV / libtorch が内部に持つスレッドプールの、CPU の取り合い(オーバーサブスクリプション)への対処
- 同時に処理中のバッチ数に応じたメモリ使用量(devcontainer は約 7GB)
- 完了条件の数値(`train.wait_hasNext` の合計を、エポック全体の何%以下にするか)
- `CMAKE_BUILD_TYPE` を指定しないときの既定値(現状、この環境の `build/` は Debug)。`CMakeLists.txt` で既定を Release にするか、開発用(Debug)と計測・学習用(Release)でビルドディレクトリを分けるか。Release 用のディレクトリ(`build-release`)は、`ai-engine/.gitignore` に追加が必要

### 関連(別課題)

- `IDatasetRepositoryFactory::create` の戻り値を `unique_ptr` にして、Decorator の連鎖の所有権を実態に合わせる(現状は `shared_ptr` で統一されている。`ITimeRecorder` は複数の Decorator で共有されるため、`shared_ptr` のままでよい)
- `ConfigReader.cpp` の `if / else if` の連なりに、設定を追加する人が集中すると、ブランチ間でコンフリクトしやすい。セクションごとの分割を検討する
- `CMakeLists.txt` に `enable_testing()` と `add_test` がなく、`ctest` は「No tests were found」となる(終了コードは 0)。テストは、実行ファイルを個別に実行する必要がある。CTest への登録を検討する
- `training_smoke_test` は、`SMOKE_SRC_DATASET`(`CMakeLists.txt`)が `dataset/train` を指している。データセットを `dataset/` 直下に置く配置では、`[SKIP]`(終了コード 0)になり、何も検査しない。データの配置の取り決めを決めて、CMake の値と `.config` の `dataset_path` を揃える

### 影響範囲

- 段階2: 新規 Decorator(`ISegmentationData` / `IImagePreprocessor` / `IImageDecoder` 用)、`DatasetRepositoryFactory`(`ITimeRecorder` を受け取る)、`TrainingApp.cpp`
- 並列化: `PreFetchDatasetRepository` またはその代替、`IDatasetRepository` の契約、`AppConfig.hpp` / `ConfigReader.cpp` / `.config`(`num_workers`)

### 完了条件

- 内訳が計測され、支配的な処理が特定されている
- 並列化の方式が決まり、`num_workers` を設定で変えられる
- 実データで、`train.wait_hasNext` の合計が、目標(未決定事項に挙げた数値)を下回る