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
