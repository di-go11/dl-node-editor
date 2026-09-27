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
- `TimedImageDecoder`(`IImageDecoder` の Decorator)で、デコードの時間を測る。画像(JPEG)とマスク(PNG)が同じインスタンスを通るため、区間名は拡張子で分ける(`image.decode.jpeg` / `image.decode.png`)。`TrainingApp.cpp` で、ファクトリに渡す前に、`OpenCvImageDecoder` を包む

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

### Release ビルドでの内訳(デコーダの計測を追加)

`TimedImageDecoder` を追加し、`getImage` / `getMask` の内訳を測った(Release ビルド、同じ条件)。`image.decode.*` は、学習・検証で共通の区間(各 326 回 = 学習 267 + 検証 59)なので、平均値で比べる。前回の Release の結果(`train.produce_getNextBatch` 平均 69.1 ms)と、ほぼ同じで(今回 66.8 ms)、再現している。

```
Name                         Count     Total(ms)    Mean(ms)     Min(ms)     Max(ms)
image.decode.jpeg              326      5933.094      18.200      13.591      31.146
image.decode.png               326      2966.802       9.101       8.346      13.860
train.produce_getNextBatch     267     17842.581      66.826      61.194      90.334
train.produce_hasNext          268         0.114       0.000       0.000       0.001
train.segdata.getImage         267      6018.376      22.541      17.737      34.459
train.segdata.getMask          267     10601.691      39.707      37.785      53.718
train.wait_getNextBatch        266         5.123       0.019       0.003       0.078
train.wait_hasNext             267     13358.967      50.034       0.000      71.125
val.produce_getNextBatch        59      3842.565      65.128      61.481      85.515
val.produce_hasNext             60         0.032       0.001       0.000       0.002
val.segdata.getImage            59      1197.139      20.290      17.560      25.845
val.segdata.getMask             59      2373.187      40.224      38.665      56.427
val.wait_getNextBatch           58         1.145       0.020       0.013       0.079
val.wait_hasNext                59      3281.534      55.619       0.000      72.970
```

学習用の1サンプルの内訳(平均、ms。差分は計算による)

| 処理 | 時間 | 生産時間に占める割合 |
|---|---|---|
| **色 → クラス ID の変換(`getMask` − `image.decode.png`)** | **約 30.6** | **約 46%** |
| JPEG のデコード(`image.decode.jpeg`) | 18.2 | 約 27% |
| PNG のデコード(`image.decode.png`) | 9.1 | 約 14% |
| 画像側のその他(`getImage` − `image.decode.jpeg`。デコーダ内の RGB 変換・並べ替え・コピーなど) | 約 4.3 | 約 6% |
| 残り(リサイズ・正規化・バッチ組み立て。produce − getImage − getMask) | 約 4.6 | 約 7% |
| 合計(`train.produce_getNextBatch`) | 66.8 | 100% |

### `RgbColor` の修正後の再計測(Release)

`ColorMaskLabelConverter` は、画素ごとに `RgbColor` を構築していた。`RgbColor` のコンストラクタが `std::vector<uint8_t>` に `{r, g, b}` を代入していたため、画素ごとにヒープ確保が発生していた(約 230 万回 / 1サンプル)。次の修正を行った。

- `RgbColor` から、`_r` / `_g` / `_b` と重複していて、どこからも使われていない `_rgbData` を削除した
- コンストラクタと `getR()` / `getG()` / `getB()` を、クラス内に定義した(インライン化。別の翻訳単位からも、展開できる)
- `getColorData()` は、呼ばれたときにだけ `{_r, _g, _b}` から、`std::vector` を作る形にした(戻り値は同じ。コード全体で、呼び出し箇所は1つもない)

修正後、Release ビルドで、同じ条件(学習 266 枚 / 検証 58 枚、`batch_size=1`、256×256、1エポック、同じ環境)で再計測した。全テスト実行ファイル(12本)は、`[FAIL]` が 0 件(`training_smoke_test` は、`dataset/train` がないため `[SKIP]`)。

学習用の平均(ms)

| 項目 | 修正前 | 修正後 | 変化 |
|---|---|---|---|
| 色 → クラス ID の変換(`getMask` − `image.decode.png`) | 約 30.6 | **約 12.3** | 約 2.5 倍速い |
| `train.segdata.getMask` | 39.7 | 21.5 | 約 1.8 倍速い |
| `train.produce_getNextBatch`(1サンプルの生産) | 66.8 | 50.7 | 約 24% 短縮 |
| `train.wait_hasNext`(学習ループの待ち) | 50.0 | 34.2 | |
| 実行全体(`real`) | 26.2 s | 18.4 s | 約 30% 短縮 |
| `image.decode.jpeg` | 18.2 | 20.3 | ほぼ同じ(触っていない処理。ばらつきの範囲) |
| `image.decode.png` | 9.1 | 9.3 | ほぼ同じ |

修正後の集計表

```
Name                         Count     Total(ms)    Mean(ms)     Min(ms)     Max(ms)
image.decode.jpeg              326      6609.666      20.275      14.252      38.957
image.decode.png               326      3015.574       9.250       8.394      17.656
train.produce_getNextBatch     267     13536.638      50.699      43.577      72.495
train.produce_hasNext          268         0.176       0.001       0.000       0.002
train.segdata.getImage         267      6568.214      24.600      17.873      42.140
train.segdata.getMask          267      5749.926      21.535      20.706      29.874
train.wait_getNextBatch        266         4.820       0.018       0.001       0.046
train.wait_hasNext             267      9120.471      34.159       0.000      59.755
val.produce_getNextBatch        59      2707.755      45.894      43.301      64.882
val.produce_hasNext             60         0.037       0.001       0.000       0.002
val.segdata.getImage            59      1196.802      20.285      17.490      33.276
val.segdata.getMask             59      1242.249      21.055      20.333      26.022
val.wait_getNextBatch           58         1.178       0.020       0.015       0.032
val.wait_hasNext                59      2195.272      37.208       0.000      54.661
```

修正後の1サンプルの内訳(学習用の平均、ms。差分は計算による): 変換 約 12.3、JPEG のデコード 20.3、PNG のデコード 9.3、画像側のその他 約 4.3、残り(リサイズ・正規化・バッチ組み立て)約 4.6、合計 50.7。

### 変換の改善後の再計測(Release。配列の直接走査 + 対応表)

`ColorMaskLabelConverter` を、次のように書き換えた。

- コンストラクタで、`ColorLabelMap` の登録エントリ(色 + クラス ID)から、整数の配列を、1回だけ組み立てる。色は、`(R << 16) | (G << 8) | B` の 24bit の整数(キー)にまとめる。`_keys`(キーの配列)と `_classIds`(クラス ID の配列)を、メンバとして持ち、`ColorLabelMap` 自体は保持しない。`ColorLabelMap` には、読み取り専用のアクセサ `getEntries()` を追加した
- `convert()` は、`ImageData::raw()` の R・G・B の各面(CHW の並び)を、ポインタで直接走査する。画素ごとに `RgbColor` を作らず、`at()` も呼ばない
- 直前の画素と同じ色なら、前回の結果を再利用する(`lastKey` / `lastClassId`。ローカル変数にして、`convert()` を `const` のまま保つ)
- 登録にない色は、従来と同じ 255 を返す(従来は `resolveClassId` の `-1` が、`uint8_t` に変換されて 255 になっていた)

同じ条件で再計測した。全テスト実行ファイル(12本)は、`[FAIL]` が 0 件(`training_smoke_test` は `[SKIP]`)。

学習用の平均(ms)

| 項目 | ① 最初の Release | ② `RgbColor` の修正後 | ③ 今回(直接走査 + 対応表) |
|---|---|---|---|
| 色 → クラス ID の変換(`getMask` − `image.decode.png`) | 約 30.6 | 約 12.3 | **約 0.9** |
| `train.segdata.getMask` | 39.7 | 21.5 | 9.7 |
| `train.produce_getNextBatch`(1サンプルの生産) | 66.8 | 50.7 | **36.1** |
| `train.wait_hasNext`(学習ループの待ち) | 50.0 | 34.2 | 20.5 |
| 実行全体(`real`) | 26.2 s | 18.4 s | **13.7 s** |
| `image.decode.jpeg`(触っていない処理) | 18.2 | 20.3 | 18.1 |
| `image.decode.png`(触っていない処理) | 9.1 | 9.3 | 8.8 |

今回の集計表

```
Name                         Count     Total(ms)    Mean(ms)     Min(ms)     Max(ms)
image.decode.jpeg              326      5903.598      18.109      13.320      33.184
image.decode.png               326      2864.793       8.788       8.117      14.441
train.produce_getNextBatch     267      9651.192      36.147      30.263      62.905
train.produce_hasNext          268         0.024       0.000       0.000       0.001
train.segdata.getImage         267      5836.545      21.860      16.087      41.959
train.segdata.getMask          267      2592.364       9.709       9.137      14.682
train.wait_getNextBatch        266         4.734       0.018       0.000       0.080
train.wait_hasNext             267      5480.240      20.525       0.000      43.053
val.produce_getNextBatch        59      2081.179      35.274      31.483      51.140
val.produce_hasNext             60         0.014       0.000       0.000       0.001
val.segdata.getImage            59      1232.877      20.896      17.643      36.763
val.segdata.getMask             59       579.504       9.822       9.062      15.553
val.wait_getNextBatch           58         1.065       0.018       0.003       0.042
val.wait_hasNext                59      1584.108      26.849       0.000      42.745
```

今回の1サンプルの内訳(学習用の平均、ms。差分は計算による)

| 処理 | 時間 | 生産時間に占める割合 |
|---|---|---|
| JPEG のデコード(`image.decode.jpeg`) | 18.1 | 約 50% |
| PNG のデコード(`image.decode.png`) | 8.8 | 約 24% |
| 画像側のその他(`getImage` − `image.decode.jpeg`) | 約 3.8 | 約 10% |
| 残り(リサイズ・正規化・バッチ組み立て) | 約 4.6 | 約 13% |
| **色 → クラス ID の変換(`getMask` − `image.decode.png`)** | **約 0.9** | **約 2.5%** |
| 合計(`train.produce_getNextBatch`) | 36.1 | 100% |

### わかったこと / 推測(Release / Debug の両方の計測を踏まえた最新)

わかったこと(計測で確認済み)

- 待ちは `PreFetchDatasetRepository::hasNext()` で発生している(内部の `condition_variable::wait`)。`getNextBatch()` はほぼ待たない(Release / Debug とも)
- Debug ビルドでは、自前のコードが最適化されておらず、`getMask` が 248 ms(生産時間の約 86%)を占めていた。Release では 40.7 ms(約 59%)。OpenCV でデコードする `getImage` は、ビルドの種類の影響が小さい(34.8 → 23.7 ms)。**Debug の値は、性能の判断に使えない**
- Release でも、学習ループはデータ待ちが多い。学習の待ち時間の合計(13.8 秒)は、生産時間の合計(18.5 秒)の約 75%
- 1回の計算時間(推定: 生産時間 − 待ち時間)は、Release で約 17.5 ms。生産時間(約 69 ms)は、その約 4 倍(Debug では約 12 倍と見積もっていた)。ワーカー数の目安は約 4 本
- 1サンプルの内訳(Release): `getMask` 約 59%、`getImage` 約 34%、リサイズ・正規化・バッチ組み立てが約 7%。リサイズ・正規化を GPU に移す案は、効果が小さい
- **`getMask` の大部分は、PNG のデコードではなく、色 → クラス ID の変換だった。** `getMask` 39.7 ms のうち、PNG のデコードが約 9.1 ms、変換が約 30.6 ms(約 77%)。変換だけで、生産時間(66.8 ms)の約 46% を占め、1つの処理として最大
- 変換は、約 230 万画素(1200×1920)で約 30 ms、つまり 1画素あたり約 13 ns(Release でも。`RgbColor` の修正前)
- JPEG のデコードは、約 18.2 ms(約 27%。修正前)。PNG のデコード(約 9.1 ms)より重い
- **変換が遅い主因は、画素ごとの `RgbColor` の構築に伴うヒープ確保だった。** `RgbColor` から、使われていない `std::vector` のメンバ(`_rgbData`)を削除し、コンストラクタと `getR()` などをインライン化しただけで、変換は約 30.6 ms から約 12.3 ms(約 2.5 倍)に縮み、`train.produce_getNextBatch` は 66.8 ms から 50.7 ms(約 24% 短縮)、実行全体は 26.2 秒から 18.4 秒(約 30% 短縮)になった
- `RgbColor` の修正後も、学習ループはデータ待ちが多い。学習の待ち時間の合計(9.1 秒)は、生産時間の合計(13.5 秒)の約 67%(修正前は約 75%)。1回の計算時間(推定: 生産時間 − 待ち時間)は約 16.5 ms で、生産時間(約 50.7 ms)はその約 3 倍(修正前は約 4 倍)。ワーカー数の目安は約 3 本
- `RgbColor` の修正後の最大の処理は、JPEG のデコード(約 20.3 ms、約 40%)だった。変換(約 12.3 ms、約 24%)、PNG のデコード(約 9.3 ms、約 18%)が続いた
- **配列の直接走査と対応表により、変換は約 12.3 ms から約 0.9 ms(約 0.4 ns/画素)に縮んだ。** 最初の Release(約 30.6 ms)からは、約 34 倍。`train.produce_getNextBatch` は 36.1 ms(最初の Release の 66.8 ms から約 46% 短縮。Debug の最初の計測、約 288 ms からは約 8 倍)、実行全体は 13.7 秒(最初の Release の 26.2 秒、Debug の 1分36秒から、それぞれ約半分、約 7 倍)
- 変換は、もうボトルネックではない(生産時間の約 2.5%)。残りの時間の大半は、JPEG のデコード(約 50%)と PNG のデコード(約 24%)で、OpenCV のビルド済みライブラリの処理
- 変換の改善後も、学習ループは、まだ、データ待ちがある。学習の待ち時間の合計(5.5 秒)は、生産時間の合計(9.7 秒)の約 57%(`RgbColor` の修正後は約 67%、最初の Release では約 75%)。1回の計算時間(推定: 生産時間 − 待ち時間)は約 15.6 ms で、生産時間(約 36.1 ms)はその約 2.3 倍。ワーカー数の目安は約 2〜3 本
- 既存の `image_pipeline_test`(黒・赤・緑の3色の領域で、クラス ID 0・1・2 を検査。色の境目もあるので、直前の色の再利用の切り替わりも通る)は、変換の改善後も `[PASS]`。`val_mIoU` は 0.3253 前後で、これまでと同程度(学習には、実行ごとのばらつきがあるため、変換結果の厳密な一致の検証にはならない)
- Debug ビルドでの CPU 使用率の測定では、ワーカーが 1コアをほぼ使い切っていた(約 94%)。Release では未測定

推測(未確認)

- JPEG の縮小デコード(`cv::IMREAD_REDUCED_COLOR_*`)を使えば、JPEG のデコードを、数分の1に縮められる見込み(見積もり)。ただし、リサイズの結果(画質・Letterbox)が変わるため、精度への影響は、未確認
- ワーカーを複数にした場合の、実際の速度の伸び(メモリ帯域、OpenCV / libtorch の内部スレッドとの取り合い)は、未確認
- 9p の I/O の寄与は、分離できていない(Release でも未確認)
- 学習マシンや CI が、Debug と Release のどちらでビルドしているかは、未確認

### やること

順序: 内訳の計測 → 設計の決定 → 並列化 → 調整。ワーカー数を可変にすることは、並列化の設計が決まってからの作業になる(現在の `PreFetch` は、状態を持つ内側のリポジトリを1本のワーカーが順に呼ぶ設計のため、数を増やすだけでは動かない)。

- [ ] 学習マシンと CI(Jenkins)のビルドの種類を確認する。Debug のままなら、性能を測る・学習を走らせるビルドは Release にする
- [x] 段階2の計測: 1サンプルの内訳を測る(主要な処理は分離できた。前処理の Decorator は、残りが約 7% と小さいため、優先度が低い)
  - [x] `ISegmentationData` の Decorator(`getImage` と `getMask` を別々に測る。`TimedVocSegmentationData`)
  - [x] `IImageDecoder` の Decorator(画像の JPEG とマスクの PNG が同じインスタンスを通るため、拡張子で名前を分ける。`TimedImageDecoder`)
  - [x] `getMask` の内訳(PNG のデコードと `ColorMaskLabelConverter::convert`)を分ける。結果: PNG のデコード 約 9.1 ms、変換 約 30.6 ms
  - [ ] (優先度低)`IImagePreprocessor` の Decorator(画像用とマスク用は別インスタンスなので、名前で区別できる)。残り(リサイズ・正規化・組み立て)は約 4.6 ms
  - 継ぎ目のない箇所(`ColorMaskLabelConverter` は具象クラスを値で保持、`ImageNormalizer::normalize` は static 関数)は、差分で求める(例: `getMask` − PNG デコード、`getNextBatch` − サンプルごとの処理の合計)。差分で足りなければ、`ILabelConverter` / `IImageNormalizer` のようなインターフェースを切り出す
  - 処理クラスに `ITimeRecorder` を持たせず、Decorator で外側から包む。`DatasetRepositoryFactory` に `ITimeRecorder` を渡し、`IImageDecoder` は `TrainingApp.cpp` で、ファクトリに渡す前に包む
- [ ] I/O の寄与を切り分ける: 同じデータをコンテナ内のローカル領域(`/tmp` など)にコピーして、`/workspaces`(9p)と比較する
- [ ] 内訳に基づいて、遅い処理そのものを改善できるか検討する(アルゴリズムの見直し、事前リサイズ、`cv::IMREAD_REDUCED_COLOR_2` による縮小デコードなど)
  - [x] 画素ごとのヒープ確保をなくす: `RgbColor` から、使われていない `_rgbData` を削除し、コンストラクタと `getR()` などをインライン化した。結果: 変換 約 30.6 ms → 約 12.3 ms、`train.produce_getNextBatch` 66.8 ms → 50.7 ms、実行全体 26.2 秒 → 18.4 秒
  - [x] `ColorMaskLabelConverter` の改善の続き: 画素ごとに `RgbColor` を作らず、`ImageData::raw()` を直接走査して、24bit の色をキーにした対応表(コンストラクタで、`ColorLabelMap` から、1回だけ組み立てる)を引く形にした。`ColorLabelMap` に、読み取り専用のアクセサ `getEntries()` を追加した。登録にない色は、従来と同じ 255 を返す。結果: 変換 約 12.3 ms → 約 0.9 ms、`train.produce_getNextBatch` 50.7 ms → 36.1 ms、実行全体 18.4 秒 → 13.7 秒
  - [ ] 変換のテストを追加する(既存の `image_pipeline_test` は、黒・赤・緑の3色だけを検査していて、次の点が、検査されていない)
    - 登録にない色(アンチエイリアスなどで生じる中間色)が 255 になること。従来の挙動の維持が、今回の最重要条件だった
    - 新旧の実装が、あらゆる色で一致すること。`ColorLabelMap::resolveClassId`(旧 API)は残っているので、基準の実装として使える。ランダムな色(登録色と未登録色を混ぜたもの)で作ったマスクを変換し、画素ごとに `static_cast<uint8_t>(resolveClassId(RgbColor(r, g, b)))` と一致するかを比べる(旧 API を、消さずに残す理由にもなる)
  - [ ] JPEG のデコード(約 18.1 ms、変換の改善後は、生産時間の約 50% で、最大の処理)は、OpenCV のビルド済みライブラリの処理で、自前のコードでは縮めにくい。入力サイズ(256×256)が元(1200×1920)より、十分小さいため、`cv::IMREAD_REDUCED_COLOR_*` による縮小デコードが候補だが、リサイズの結果(画質・Letterbox)が変わるため、精度への影響を確認する
- [ ] 並列化の設計を決める(下の「未決定事項」)
- [ ] 決めた設計に、ワーカー数のパラメータ(`.config` の `num_workers` など。既定 1 = 現状の動作)を持たせる
- [ ] ワーカー数を変えながら計測機能で確認し、調整する
- [ ] 単体テストを追加する(`BufferTimeRecorder` を複数スレッドから呼んでも壊れない、`CoutTimeReportWriter` の集計値、`TimedDatasetRepository` が呼び出しを素通しする)

### 決定事項

- 計測は Decorator で処理クラスの外側に置く(処理クラスを `ITimeRecorder` に依存させない)
- 計測のオン・オフは `.config`(`enable_time_measurement`)で切り替え、オフのときは `NullTimeRecorder`(Null Object)を注入する
- ワーカー数は固定値にせず、設定値にする。「生産時間 ÷ 計算時間」は、Debug ビルドで約 12、Release ビルド(`RgbColor` の修正前)で約 4、修正後で約 3、変換の改善後で約 2.3 だった(条件は `batch_size=1`、256×256、この環境)。目安にすぎず、ビルドの種類・バッチサイズ・モデルを変えると、適切な数も変わる
- 性能の計測と調整は、Release ビルド(`-O3`)で行う。Debug ビルドの値は、自前のコードが最適化されておらず、判断には使わない

### 未決定事項

- 並列化の方式
  - 案A: 1バッチ内のサンプルごとの処理を並列にする(`batch_size` が並列度の上限になる。`batch_size=1` では効果がない)
  - 案B: 複数のワーカーが別々のバッチを作る(PyTorch の `num_workers` 方式。「何番目のバッチ」と指定すれば作れる、状態を持たない形と、順序付きのキューが必要。`IDatasetRepository` の設計の見直しを伴う)
  - 案C: libtorch の DataLoader(`workers(N)`)を使う(上の当初の構成図の方向)
  - 案D: 1サンプルの処理自体を速くする(有力で、大きな効果があった。`RgbColor` のヒープ確保の除去と、変換の改善で、生産時間が 66.8 ms から 36.1 ms(約 46%)縮んだ。変換は、もうボトルネックではなく、残りの大半は JPEG と PNG のデコード。JPEG の縮小デコードを検討した後で、ワーカー数の目安を再計測して、並列化の要否を判断する)
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