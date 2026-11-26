import { describe, expect, it } from 'vitest'

import { validateLrScheduler } from '../validation/validate-training'
import { validateLrScheduleContinuity } from '../validation/validate-resume'

import type { LrSchedulerSettings } from './lr-scheduler'
import { defaultLrScheduler, defaultUpdateIntervalOf, LR_SCHEDULER_TYPES } from './lr-scheduler'
import { trainingSettingsFromJson, trainingSettingsToJson } from './proto-json/convert'
import { trainingSettingsJsonSchema } from './proto-json/schema'
import type { TrainingSettings } from './training-settings'
import { defaultTrainingSettings } from './training-settings'
import { defaultVariant } from './variant'

function scheduler(
  kind: keyof typeof LR_SCHEDULER_TYPES,
  patch: Partial<LrSchedulerSettings> = {},
): LrSchedulerSettings {
  return {
    scheduler: defaultVariant(LR_SCHEDULER_TYPES, kind),
    updateInterval: defaultUpdateIntervalOf(kind),
    warmupEpochs: 0,
    ...patch,
  }
}

function settingsWith(lrScheduler: LrSchedulerSettings, patch: Partial<TrainingSettings> = {}) {
  return { ...defaultTrainingSettings(), lrScheduler, ...patch }
}

const codesOf = (issues: readonly { code: string; field?: string }[]) =>
  issues.map((issue) => [issue.code, issue.field])

describe('学習率スケジューラの既定値', () => {
  it('none・warmup なし。種類ごとの更新の単位の初期値は poly / cosine がバッチ、step がエポック', () => {
    expect(defaultLrScheduler()).toEqual(scheduler('none'))
    expect(defaultUpdateIntervalOf('poly')).toBe('per_batch')
    expect(defaultUpdateIntervalOf('cosine')).toBe('per_batch')
    expect(defaultUpdateIntervalOf('step')).toBe('per_epoch')
  })
})

describe('保存ファイル(proto-json)', () => {
  it('項目のない保存ファイル(この機能より前)は none として読む', () => {
    const { lr_scheduler: _omitted, ...json } = trainingSettingsToJson(defaultTrainingSettings())
    const parsed = trainingSettingsJsonSchema.parse(json)
    expect(trainingSettingsFromJson(parsed).lrScheduler).toEqual(defaultLrScheduler())
  })

  it('書き出して読み戻すと同じ設定になる', () => {
    const settings = settingsWith(
      scheduler('step', {
        scheduler: { kind: 'step', params: { step_size: 10, gamma: 0.5 } },
        warmupEpochs: 2,
      }),
    )
    const json = trainingSettingsJsonSchema.parse(trainingSettingsToJson(settings))
    expect(json.lr_scheduler).toEqual({
      scheduler: { step: { step_size: 10, gamma: 0.5 } },
      update_interval: 'LEARNING_RATE_UPDATE_INTERVAL_PER_EPOCH',
      warmup_epochs: 2,
    })
    expect(trainingSettingsFromJson(json)).toEqual(settings)
  })
})

describe('validateLrScheduler', () => {
  it('none で warmup なしなら問題なし', () => {
    expect(validateLrScheduler({ settings: settingsWith(scheduler('none')) })).toEqual([])
  })

  it('none なのに warmup がある', () => {
    const issues = validateLrScheduler({
      settings: settingsWith(scheduler('none', { warmupEpochs: 1 })),
    })
    expect(codesOf(issues)).toEqual([
      ['training/lr-scheduler-conflict', 'lr_scheduler.warmup_epochs'],
    ])
  })

  it('warmup はエポック数より小さくする', () => {
    const ok = settingsWith(scheduler('poly', { warmupEpochs: 9 }), { epoch: 10 })
    expect(validateLrScheduler({ settings: ok })).toEqual([])
    const ng = settingsWith(scheduler('poly', { warmupEpochs: 10 }), { epoch: 10 })
    expect(codesOf(validateLrScheduler({ settings: ng }))).toEqual([
      ['training/lr-scheduler-conflict', 'lr_scheduler.warmup_epochs'],
    ])
  })

  it('cosine の最小の学習率は optimizer の学習率以下', () => {
    const base = defaultTrainingSettings()
    const learningRate = base.optimizer.params['learning_rate'] as number
    const withMinLr = (min_lr: number) =>
      settingsWith(scheduler('cosine', { scheduler: { kind: 'cosine', params: { min_lr } } }))
    expect(validateLrScheduler({ settings: withMinLr(learningRate) })).toEqual([])
    expect(codesOf(validateLrScheduler({ settings: withMinLr(learningRate * 2) }))).toEqual([
      ['training/lr-scheduler-conflict', 'lr_scheduler.cosine.min_lr'],
    ])
  })

  it('パラメータの範囲はカタログで確かめる(step の gamma は 0 より大きく 1 以下)', () => {
    const issues = validateLrScheduler({
      settings: settingsWith(
        scheduler('step', { scheduler: { kind: 'step', params: { step_size: 10, gamma: 2 } } }),
      ),
    })
    expect(codesOf(issues)).toEqual([['training/param-invalid', 'lr_scheduler.step.gamma']])
  })
})

describe('validateLrScheduleContinuity(再開)', () => {
  const saved = settingsWith(scheduler('poly'), { epoch: 10, batch: 8 })
  const input = (settings: TrainingSettings) => ({ settings, completedEpochs: 10, savedSettings: saved })

  it('スケジューラが none なら何も言わない', () => {
    const none = settingsWith(scheduler('none'), { epoch: 10 })
    expect(
      validateLrScheduleContinuity({
        settings: { ...none, epoch: 20 },
        completedEpochs: 10,
        savedSettings: none,
      }),
    ).toEqual([])
  })

  it('poly でエポック数を変えると、曲線がつながらないという warning(止めない)', () => {
    const issues = validateLrScheduleContinuity(input({ ...saved, epoch: 20 }))
    expect(issues).toMatchObject([
      { severity: 'warning', code: 'training/lr-schedule-discontinuous', field: 'lr_scheduler' },
    ])
  })

  it('バッチごとに更新するときは、バッチサイズの変更でも warning', () => {
    const issues = validateLrScheduleContinuity(input({ ...saved, batch: 4 }))
    expect(issues).toHaveLength(1)
  })

  it('何も変えなければ warning なし', () => {
    expect(validateLrScheduleContinuity(input(saved))).toEqual([])
  })
})
