import type { Variant, VariantDef } from './variant'

/**
 * loss(損失関数)のカタログ。training.proto の LossConfig(oneof)に対応する。
 *
 * 並び順は proto の oneof の番号順(= C++ の LossType の並び)にそろえている。
 * 画面の選択肢もこの順に出る。
 *
 * num_classes / ignore_index はデータセット由来の値なので、ここには持たない
 * (proto のコメントのとおり)。ignore_index はタスクの設定(data-spec.ts)にある。
 *
 * どの loss をどのタスクで使えるか(Dice はセグメンテーション専用、など)の制限は
 * 未決事項 1 であり、ここでは表さない。決まったら、検証ルールを 1 つ足して扱う。
 */
export const LOSS_TYPES = {
  cross_entropy: {
    label: 'Cross Entropy',
    description: '予測した確率分布と正解の差。分類・セグメンテーションの標準。',
    params: {},
  },
  mse: {
    label: 'MSE',
    description: '平均二乗誤差。予測値と正解の差の 2 乗の平均。',
    params: {},
  },
  dice: {
    label: 'Dice',
    description: '予測と正解の領域の重なりを測る。小さな領域が多いセグメンテーションに強い。',
    params: {},
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
  },
  boundary: {
    label: 'Boundary',
    description: '領域の境界までの距離で誤りを重み付けする。境界の精度を上げたいときに使う。',
    params: {},
  },
} satisfies Record<string, VariantDef>

export type LossKind = keyof typeof LOSS_TYPES

export type LossConfig = Variant<LossKind>

export const DEFAULT_LOSS_KIND: LossKind = 'cross_entropy'
