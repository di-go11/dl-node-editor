import type { FloatParamDef } from '../param/param-def'

import type { Variant, VariantDef } from './variant'

/**
 * optimizer のカタログ。training.proto の OptimizerConfig(oneof)に対応する。
 *
 * 制約は契約(openapi.yaml の AdamConfig など)と同じにしている。C++ 側
 * (TrainingProtoMapper.cpp)が確かめるのは learning_rate > 0 と eps > 0 だけだが、
 * フロントは契約に従ってそれより厳しく確かめる。beta = 1 のような値は C++ を
 * 通っても学習が進まないので、送る前に止めたほうが原因が分かりやすい。
 *
 * 既定値は PyTorch(libtorch)の既定値に合わせている。論文や実装例の多くが
 * この値を前提にしているため、何も変えなければ「よく知られた設定」になる。
 */

// 3 種類に共通する項目。同じ定義を 3 回書くと、片方だけ直す事故が起こるため共有する
const learningRate = (defaultValue: number): FloatParamDef => ({
  kind: 'float',
  label: '学習率',
  default: defaultValue,
  exclusiveMin: 0,
  help: '1 回の更新で重みを動かす大きさ。大きすぎると発散し、小さすぎると進まない。',
})

const weightDecay = (defaultValue: number): FloatParamDef => ({
  kind: 'float',
  label: '重み減衰',
  default: defaultValue,
  min: 0,
  help: '重みを 0 に引き寄せる正則化の強さ。過学習を抑える。',
})

const beta1: FloatParamDef = {
  kind: 'float',
  label: 'β1',
  default: 0.9,
  min: 0,
  exclusiveMax: 1,
  help: '勾配の移動平均(1 次モーメント)の減衰率。',
}

const beta2: FloatParamDef = {
  kind: 'float',
  label: 'β2',
  default: 0.999,
  min: 0,
  exclusiveMax: 1,
  help: '勾配の 2 乗の移動平均(2 次モーメント)の減衰率。',
}

export const OPTIMIZER_TYPES = {
  adam: {
    label: 'Adam',
    description: '勾配の 1 次・2 次モーメントで学習率を自動調整する。最初に試す定番。',
    params: {
      learning_rate: learningRate(1e-3),
      weight_decay: weightDecay(0),
      beta1,
      beta2,
      eps: {
        kind: 'float',
        label: 'ε',
        default: 1e-8,
        exclusiveMin: 0,
        help: '0 除算を防ぐために分母に足す小さな値。',
      },
    },
  },
  adam_w: {
    label: 'AdamW',
    description:
      'Adam の重み減衰を勾配から切り離したもの。重み減衰を効かせたいときは Adam より適する。',
    params: {
      learning_rate: learningRate(1e-3),
      weight_decay: weightDecay(1e-2),
      beta1,
      beta2,
    },
  },
  sgd: {
    label: 'SGD',
    description:
      '確率的勾配降下法。モーメンタムと組み合わせると、汎化性能で Adam に勝つこともある。',
    params: {
      learning_rate: learningRate(1e-2),
      weight_decay: weightDecay(0),
      momentum: {
        kind: 'float',
        label: 'モーメンタム',
        default: 0.9,
        min: 0,
        help: '前回の更新方向をどれだけ引き継ぐか。0 なら素の SGD。',
      },
      nesterov: {
        kind: 'bool',
        label: 'Nesterov',
        default: false,
        help: '一歩先の位置で勾配を計算する Nesterov の加速法を使う。',
      },
    },
  },
} satisfies Record<string, VariantDef>

export type OptimizerKind = keyof typeof OPTIMIZER_TYPES

export type OptimizerConfig = Variant<OptimizerKind>

export const DEFAULT_OPTIMIZER_KIND: OptimizerKind = 'adam'
