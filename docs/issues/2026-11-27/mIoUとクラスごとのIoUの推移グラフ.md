# feat:mIoU とクラスごとの IoU の推移をグラフにする

## 問題点

学習中の画面と「学習の記録」画面には、loss と学習率の推移のグラフはあるが、mIoU とクラスごとの IoU は**最新のエポックの値**(学習中の画面)か**表の数値**(学習の記録)でしか見られない。

| 困ること | 理由 |
|---|---|
| 損失関数を変えた学習どうしを比べられない | Cross Entropy・Focal・Dice は loss の値の大きさの基準が違う。loss のグラフを並べても、どれが良いか分からない。共通の物差しは mIoU |
| 少ないクラスがいつ伸びなくなったか分からない | 例: SegNet・3 クラスの学習でクラス 2 の IoU が 0.37。途中で頭打ちになったのか、ずっと低いのか、下がったのかが表からは読み取りにくい(200 行) |
| 過学習や学習率の影響が見えない | val_loss が下がっていても IoU が下がることがある。学習率のグラフと並べて見たい |

## 方針

**DB にすでにあるエポックごとの mIoU とクラスごとの IoU を、loss のグラフと同じ作りで折れ線にする。フロントの変更だけで済ませる。**

- 学習中の画面は進捗のストリーム(`TrainingProcess.metrics`)、学習の記録は `GET /models/{model_id}/history` の `EpochRecord.metrics` に、どちらもすでに `miou` と `per_class_iou` が入っている。C++・proto・Rust・DB は変えない
- 分類タスクも同じ部品で描く(mIoU → accuracy、クラスごとの IoU → クラスごとの accuracy)。データの形が同じなので、分けて作るより安い

## 設計

### entity(`entity/training/metric-points.ts`)

```ts
/** グラフの 1 点。値がない(メトリクスを計算していない・NaN)ところは null にして線を切る */
export type MetricPoint = {
  readonly epoch: number
  /** segmentation は mIoU、classification は accuracy */
  readonly main: number | null
  /** クラスの番号順。segmentation は IoU、classification は accuracy */
  readonly perClass: readonly (number | null)[]
}
```

| 関数 | 内容 |
|---|---|
| `appendMetricPoint(points, progress)` | 学習中の画面用。`appendLossPoint` と同じく、同じエポックが来たら置き換える |
| `historyMetricPoints(history)` | 学習の記録用。`latestEpochs()` で再開をまたいだエポックを並べ、各エポックの metrics から作る |
| `metricLabelsOf(points)` | 凡例の名前(`mIoU` / `accuracy`、`クラス 0 の IoU` …)とクラス数 |

- 値が NaN / inf / null のときは `null` にする(検証データに現れないクラスの IoU は NaN になる。0 と区別する)
- `history.ts` の `perClassValuesOf` を使い回す

### presentation(`components/progress/MetricsChart.tsx`)

```
mIoU とクラスごとの IoU の推移
  [✓] mIoU   [✓] クラス 0   [✓] クラス 1   [✓] クラス 2        ← 線の表示の切り替え
1.0 ┤
    │      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  クラス 0
0.8 ┤   ╭──────────────────────────────────  クラス 1
    │  ╭╯ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  mIoU(太線)
0.4 ┤ ╭╯ ╭───────────────────────────────── クラス 2
0.0 ┼─┴──┴──────────────────────────────── epoch
```

- `LossChart` / `LearningRateChart` と同じ recharts で描き、横軸(エポック)の作りを揃える
- **縦軸は 0〜1 に固定する。** 学習ごとに縦軸の範囲が変わると、別の学習のグラフ(SVG)を並べたときに比べられない
- mIoU は太い線、クラスごとは細い線。クラスの色は分類用の配色(色だけに頼らず、凡例と線の終わりに名前を出す)
- 線ごとに表示を切り替えられる(チェックボックス)。クラスが多い(Pascal VOC は 21 クラス)と線が重なって読めないため
- mIoU は背景(クラス 0)を除いた平均であること(C++ の `TorchModelEvaluator` の計算)を、グラフの下に一言書く。クラスごとの線の平均と合わないと混乱するため

### 置き場所

| 画面 | 置く場所 |
|---|---|
| 学習中の画面(`ProgressPage`) | 「loss の推移」の下。点は `use-training-progress` で受け取るたびに足す(`learningRatePoints` と同じ) |
| 「学習の記録」画面(`TrainedModelHistoryPage`) | 「loss の推移」の下。「SVG で保存」のボタンを付ける(ファイル名は `<モデル名>_metrics.svg`)。`chartSvgOf` をそのまま使う |

- メトリクスが 1 エポックもない記録では、グラフの代わりに「この学習にはメトリクスの記録がありません」と出す(学習率のグラフと同じ扱い)

## 段階

1. **entity**: `MetricPoint` と 3 つの関数、テスト
2. **部品**: `MetricsChart`(縦軸の固定・線の切り替え・凡例)
3. **画面**: 学習中の画面(`use-training-progress` に点を足す)と学習の記録(SVG で保存)
4. **確認**: 下の完了条件

## テスト

- `metric-points.test.ts`
    - segmentation の metrics から mIoU とクラスごとの IoU の点ができる / classification では accuracy になる
    - metrics が null のエポック・NaN のクラスは null になる(0 にしない)
    - `appendMetricPoint`: 同じエポックが来たら置き換える
    - `historyMetricPoints`: 再開でやり直したエポックは後の run の値になる(`latestEpochs` と同じ)
- `MetricsChart.test.tsx`: 凡例にクラスの数だけ項目が出る / チェックを外すとその線が消える / 点がなければ文言を出す
- `ProgressPage.test.tsx`・学習の記録の画面のテスト: メトリクスを含む進捗・記録でグラフの見出しが出る

## 決めること

1. **クラスが多いときに最初に表示する線**
    - 案 A(おすすめ): 8 クラス以下なら全部、それより多ければ mIoU だけを表示し、クラスは利用者が選ぶ
    - 案 B: いつも全部表示する。21 クラスでは読めない
2. **学習中の画面にも置くか**
    - 案 A(おすすめ): 置く。学習の途中で頭打ちに気づければ、止めて設定を変えられる
    - 案 B: 学習の記録だけに置く。学習中の画面は loss と学習率だけにして軽く保つ

## 対象外

- 最も良かったエポック(mIoU が最高のエポック)の印や表示。グラフができた後に別の issue で足す
- 複数のモデルのグラフを 1 つに重ねる比較画面
- 学習データ(train)での mIoU。いまは検証データでしか計算していない(C++ の変更が要る)
- クラス名の表示(labelmap のクラス名を DB に保存する作業が要る。「混同行列の表示.md」の対象外と同じ)

## 完了条件

- 学習中の画面で、エポックが終わるたびに mIoU とクラスごとの IoU の線が伸びる
- 「学習の記録」画面で、全エポックの mIoU とクラスごとの IoU のグラフが出て、SVG で保存できる
- 縦軸が 0〜1 に固定されていて、別の学習の SVG と並べて比べられる
- 線ごとに表示を切り替えられる
- 分類タスクの記録では accuracy とクラスごとの accuracy で描かれる
- メトリクスのない記録を開いても壊れず、文言が出る
