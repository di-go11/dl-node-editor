# method-evaluation

## models_type

- セマンティックセグメンテーション
  - 分類モデル
- Vision Transformer
  - 知らん

## 評価手法

### 分類モデル

**Base**
**混同行列**

|              | positive           | negative           |
| ------------ | ------------------ | ------------------ |
| **positive** | true positive(TP)  | false negative(FN) |
| **negative** | false positive(FP) | true negative(TN)  |

**評価指標**

1. **正解率(Accuracy)**

**全体のうち、どれだけ正しく予測できたか**

**$Accuracy = \frac{TP + TN}{TP+TN+FP+FN}$**

2. **適合率(Precision)**

**「正」と予測したデータのうち、実際に正だった割合**

**$Precision = \frac{TP}{TP + FP}$**

3. **再現率(Recall)**

**実際に「正」であるデータのうち、どれだけ「正」と予測できたか**

**$Recall = \frac{TP}{TP + FN}$**

4. **F値(F1-score)**

**PrecisionとRecallの調和平均**

**$F1 = 2\times \frac{Precision\times Recall}{Precision + Recall}$**

5. **特異度(Specificity)**

**実際に「負」だったデータのうち、正しく「負」として予測できたのは何割か?**

**$Specificity = \frac{TN}{TN + FP}$**

6. **偽陽性率(False Positive Rate)**

**実際に「負」だったデータのうち、「正」と予測してしまったのは何割か?**

**$FPR = \frac{FP}{TN + FP}$**

7. **ROC曲線とAUC**

ROC曲線について後ほど勉強しながらまとめる

#### 他クラス分類タスク(今回のセマンティックセグメンテーションのような場合これをつかう?)

クラス(A,B,C)とあった際に、AをPositive(対象)とした場合、B,CはともにNegativeとなる。この場合においてそれぞれのクラスの場合で$Accuracy_n,Recall_n,Precision_n,F1_n$を求め、それぞれの平均を取る。これをmacro平均と呼ぶ

$Accuracy_M = \sum_1^n  \frac{Accuracy_x}{x}$

例
**$Accuracy_M = \frac{Accuracy_A + Accuracy_B + Accuracy_C}{3}$**

### セマンティックセグメンテーションのMetrics

#### IoU(Intersection over Union)

- 参考資料
  - [https://qiita.com/CM_Koga/items/82d446658957d51836cf](https://qiita.com/CM_Koga/items/82d446658957d51836cf)

**予測領域**と**正解領域**がどれだけ重なっているかを表す精度指標。

$$IoU = \frac{A\cap B}{A\cup B}$$

- A: 正解領域
- B: 予測領域

#### mIoU(mean Intersection over Union)

- 参考資料
  - [https://qiita.com/krrka/items/9c531305a88a268954ea](https://qiita.com/krrka/items/9c531305a88a268954ea)
  - [https://note.com/daily_epoch/n/n76abf2a561f4](https://note.com/daily_epoch/n/n76abf2a561f4)

**全クラスのIoUの平均**。セグメンテーションの論文で最も頻繁に使われる指標であり、**クラス間のバランスを考慮した評価**が可能。

$$mIoU = \frac{1}{N} \sum_{i=1}^N IoU_i =\frac{1}{k}\sum_{i=1}^k \frac{N_{ii}}{\sum_{j=1}^k N_{ij} + \sum_{j=1}^k N_{ji} - N_{ii}}$$

- $N_{ij}$: 正解クラスがiであるピクセルをモデルがくらすjに分類した数。
- k:クラス数

具体例:
モデルA(背景だけ正解)

- 背景IoU = 1.0
- ブロッコリーIoU = 0.0
- mIoU = 0.5
- Pixel Accuracy = 0.9
モデルB(両方そこそこ正解)

- 背景IoU = 0.85
- ブロッコリーIoU = 0.70
- mIoU = 0.775
- Pixel Accuracy = 0.85

少数クラスも精度結果に正しく反映されている事がわかる。

#### FwIoU(Frequency Weighted Intersection over Union)

各クラスのIoUを、そのクラスの出現頻度で重み付けした平均。

$$FWIUoU = \frac{1}{\sum_{i=1}^N |A_i|} \sum_{i=1}^N |A_i| IoU_i$$

面積の大きいクラスを重視したい場合に使われる。

#### Dice係数(Dice Coefficient)

Dice係数は、**2つの集合の類似度**を測る指標。

$$ Dice = \frac{2|A\cap B|}{|A| + |B|} = \frac{2TP}{2TP + FP + FN}$$

##### IoUとDice係数の関係

IoUとDice係数は相互に変換できる。

$$Dice = \frac{2IoU}{1 + IoU}$$
$$IoU = \frac{Dice}{2 - Dice}$$

本質としては同じものを使っているため、どっちを使っても評価の結論は変わらない。論文に合わせて使い分ける。

#### Pixel Accuracy

全ピクセルのうち、正しく分類できたピクセルの割合.

$$Pixel Accuracy = \frac{TP + TN}{TP + TN + FP + FN}$$

問題点: クラスの面積に偏りがある場合、少数クラスの性能が無視されやすい。
今回のブロッコリーの画像の場合:

- 背景: 画像の90%
- ブロッコリー, 茎: 画像の10%

ブロッコリーや茎が検出できていなくても背景と予測するだけで、Pixel Accuracyは90%となってしまう。

#### mean Accuracy

各クラスのAccuracyを平均したもの。$$mean Accuracy = \frac{1}{N} \sum_{i=1}^N Accuracy_i = \frac{1}{N} \sum_{i=1}^N \frac{TP_i}{TP_i + FN_i}$$