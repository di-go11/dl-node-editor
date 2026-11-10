import type { ImageTaskKind } from './data-spec'
import type { Variant, VariantDef } from './variant'

/**
 * loss が Output から受け取ることを期待する値。
 *
 *   logits        … softmax をかける前の値。loss の中で softmax をかける(CrossEntropy)
 *   probabilities … softmax をかけた後の確率。loss の中では softmax をかけないので、
 *                   モデルの最後に Softmax を置く必要がある(Dice / Focal / Combo / Boundary)
 *   raw           … 値をそのまま比べる。活性化への期待はない(MSE)
 *
 * C++ の実装(training/infrastructure/torchFunc/*.cpp)をそのまま写したものである。
 * C++ 側の作りが変わったら、ここの値を変える。
 */
export type LossInput = 'logits' | 'probabilities' | 'raw'

/**
 * loss 1 種類の定義。バリアントの定義に、C++ との対応関係のデータを足したもの。
 * 検証(validate-training.ts / output-activation.ts)と学習設定画面の両方がここを読む。
 */
export type LossDef = VariantDef & {
  readonly input: LossInput
  /** この loss を使えるタスク。空なら今はどのタスクでも使えない */
  readonly tasks: readonly ImageTaskKind[]
}

/**
 * loss(損失関数)のカタログ。training.proto の LossConfig(oneof)に対応する。
 *
 * 並び順は proto の oneof の番号順(= C++ の LossType の並び)にそろえている。
 * 画面の選択肢もこの順に出る。
 *
 * num_classes / ignore_index はデータセット由来の値なので、ここには持たない
 * (proto のコメントのとおり)。ignore_index はタスクの設定(data-spec.ts)にある。
 *
 * ## どのタスクで使えるか(未決事項 1。ユーザーと合意済み)
 *
 * 今の 6 つの loss は、どれも画素ごと(予測 N×C×H×W と正解のクラス番号 N×H×W)に
 * 計算する作りなので、セグメンテーション専用である。MSE は予測と正解の形も型も合わない
 * (正解がクラス番号のため)ので、今はどのタスクでも使えない扱いにしている。
 * 組み合わせが不正なら、整合性チェックで error にする。
 */
export const LOSS_TYPES = {
  cross_entropy: {
    label: 'Cross Entropy',
    description: '予測した確率分布と正解の差。分類・セグメンテーションの標準。',
    params: {},
    input: 'logits',
    tasks: ['segmentation'],
  },
  mse: {
    label: 'MSE',
    description: '平均二乗誤差。予測値と正解の差の 2 乗の平均。',
    params: {},
    input: 'raw',
    // 正解がクラス番号のタスクでは、予測と形も型も合わない
    tasks: [],
  },
  dice: {
    label: 'Dice',
    description: '予測と正解の領域の重なりを測る。小さな領域が多いセグメンテーションに強い。',
    params: {},
    input: 'probabilities',
    tasks: ['segmentation'],
  },
  focal: {
    label: 'Focal',
    description: '易しい例の重みを下げ、難しい例に学習を集中させる Cross Entropy の変形。',
    params: {
      gamma: {
        kind: 'float',
        label: 'γ',
        default: 2,
        min: 0,
        help: '易しい例の重みを下げる強さ。0 なら Cross Entropy と同じ。慣例は 2。',
      },
      alpha: {
        kind: 'float',
        label: 'α',
        default: 0.25,
        min: 0,
        max: 1,
        help: 'クラス不均衡を補正する重み。',
      },
    },
    input: 'probabilities',
    tasks: ['segmentation'],
  },
  combo: {
    label: 'Combo',
    description: 'Cross Entropy と Dice の重み付き和。',
    params: {
      alpha: {
        kind: 'float',
        label: 'α',
        // proto に既定値はなく、未設定だと 0.0(= Dice だけ)になる。送る側が必ず埋める
        default: 0.5,
        min: 0,
        max: 1,
        help: 'Cross Entropy 項の重み。(1 - α) が Dice 項の重みになる。',
      },
    },
    input: 'probabilities',
    tasks: ['segmentation'],
  },
  boundary: {
    label: 'Boundary',
    description: '領域の境界までの距離で誤りを重み付けする。境界の精度を上げたいときに使う。',
    params: {},
    input: 'probabilities',
    tasks: ['segmentation'],
  },
} satisfies Record<string, LossDef>

export type LossKind = keyof typeof LOSS_TYPES

export type LossConfig = Variant<LossKind>

export const DEFAULT_LOSS_KIND: LossKind = 'cross_entropy'
