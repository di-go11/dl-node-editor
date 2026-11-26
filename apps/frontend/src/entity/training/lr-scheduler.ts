import type { IntParamDef } from '../param/param-def'

import type { Variant, VariantDef } from './variant'
import { defaultVariant } from './variant'

/**
 * 学習率スケジューラのカタログ。training.proto の LearningRateSchedulerConfig(oneof)に対応する。
 *
 * 基準の学習率(lr0)は optimizer の learning_rate で、スケジューラ側には持たない
 * (学習率の指定は 1 か所だけにする。issue「学習の安定化」の段階 3b)。
 * 制約は契約(openapi.yaml の PolyScheduler など)と同じにしている。
 * optimizer の学習率や epoch とまたがる制約(min_lr ≤ 学習率、warmup < epoch)は、
 * validation/validate-training.ts の validateLrScheduler が確かめる。
 */
export const LR_SCHEDULER_TYPES = {
  none: {
    label: 'なし',
    description: '学習率を変えない。optimizer の学習率のまま学習する。',
    params: {},
  },
  poly: {
    label: 'Poly',
    description:
      '学習率 × (1 − 進んだ割合)^power で、最後に向けて 0 まで下げる。セグメンテーションでよく使う。',
    params: {
      power: {
        kind: 'float',
        label: 'power',
        default: 0.9,
        exclusiveMin: 0,
        help: '大きいほど早い段階から下がる。0.9 がよく使われる。',
      },
    },
  },
  cosine: {
    label: 'Cosine',
    description: '余弦曲線で、学習率から最小の学習率までなめらかに下げる。',
    params: {
      min_lr: {
        kind: 'float',
        label: '最小の学習率',
        default: 0,
        min: 0,
        help: '最後にこの値まで下げる。optimizer の学習率以下にする。',
      },
    },
  },
  step: {
    label: 'Step',
    description: '決まったエポック数ごとに、学習率を一定の倍率で下げる。',
    params: {
      step_size: {
        kind: 'int',
        label: '間隔(エポック)',
        default: 30,
        min: 1,
        help: 'このエポック数ごとに学習率を下げる。',
      },
      gamma: {
        kind: 'float',
        label: '倍率',
        default: 0.1,
        exclusiveMin: 0,
        max: 1,
        help: '下げるときにかける値。0.1 なら 1 桁下がる。',
      },
    },
  },
} satisfies Record<string, VariantDef>

export type LrSchedulerKind = keyof typeof LR_SCHEDULER_TYPES

/** 学習率を変える単位。proto の LearningRateUpdateInterval */
export type LrUpdateInterval = 'per_batch' | 'per_epoch'

export const LR_UPDATE_INTERVALS: readonly LrUpdateInterval[] = ['per_batch', 'per_epoch']

export const LR_UPDATE_INTERVAL_LABELS: Readonly<Record<LrUpdateInterval, string>> = {
  per_batch: 'バッチごと',
  per_epoch: 'エポックごと',
}

/** 学習率スケジューラの設定。training.proto の LearningRateSchedulerConfig */
export type LrSchedulerSettings = {
  readonly scheduler: Variant<LrSchedulerKind>
  readonly updateInterval: LrUpdateInterval
  /** 最初のこのエポック数で学習率を上げていく。0 なら warmup しない(none のときは 0) */
  readonly warmupEpochs: number
}

export const WARMUP_EPOCHS_DEF: IntParamDef = {
  kind: 'int',
  label: 'warmup のエポック数',
  default: 0,
  min: 0,
  help: '最初のこのエポック数で、学習率を 0 付近から少しずつ上げる。0 なら warmup しない。epoch より小さくする。',
}

/**
 * 種類を選んだときの、更新の単位の初期値。
 * poly / cosine はなめらかに下げる式なのでバッチごと、step はエポックの区切りで下げるのでエポックごと。
 */
export function defaultUpdateIntervalOf(kind: LrSchedulerKind): LrUpdateInterval {
  return kind === 'step' ? 'per_epoch' : 'per_batch'
}

/** スケジューラなし。保存ファイルに項目がない場合(この機能より前のファイル)もこれとして読む */
export function defaultLrScheduler(): LrSchedulerSettings {
  return {
    scheduler: defaultVariant(LR_SCHEDULER_TYPES, 'none'),
    updateInterval: defaultUpdateIntervalOf('none'),
    warmupEpochs: WARMUP_EPOCHS_DEF.default,
  }
}
