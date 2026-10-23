// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { paramSchemaOf } from '../node-catalog/param-def'

import { IMAGE_SIZE_DEFS } from './data-spec'
import {
  DEVICE_PATTERN,
  MAX_SEED,
  MODEL_NAME_PATTERN,
  TRAINING_NUMBER_DEFS,
  defaultTrainingSettings,
} from './training-settings'

describe('defaultTrainingSettings', () => {
  it('画像のセグメンテーション / Adam / Cross Entropy を初期値にする', () => {
    const settings = defaultTrainingSettings()
    expect(settings.optimizer.kind).toBe('adam')
    expect(settings.loss.kind).toBe('cross_entropy')
    expect(settings.dataSpec).toMatchObject({
      kind: 'image',
      inputWidth: 256,
      inputHeight: 256,
      annotation: { kind: 'pascal_voc', params: { include_difficult: false } },
      task: { kind: 'segmentation', params: { ignore_index: 255 } },
    })
  })

  it('device は決め打ちせず空にする(capabilities を見て選ばせる)', () => {
    expect(defaultTrainingSettings().device).toBe('')
  })

  it('seed は未指定(null)を初期値にする', () => {
    expect(defaultTrainingSettings().seed).toBeNull()
  })

  it('呼ぶたびに新しい値を返す(共有された値を書き換える事故を防ぐ)', () => {
    expect(defaultTrainingSettings()).not.toBe(defaultTrainingSettings())
    expect(defaultTrainingSettings()).toEqual(defaultTrainingSettings())
  })
})

describe('数値の項目の定義', () => {
  const defs = { ...TRAINING_NUMBER_DEFS, ...IMAGE_SIZE_DEFS }

  for (const [name, def] of Object.entries(defs)) {
    it(`${name} の既定値は自分の制約を満たす`, () => {
      expect(paramSchemaOf(def).safeParse(def.default).success).toBe(true)
    })
  }

  it('seed の上限は 2^53 - 1(これを超えると number で正確に表せない)', () => {
    expect(MAX_SEED).toBe(2 ** 53 - 1)
    // 2^53 と 2^53 + 1 は number では同じ値になってしまう
    expect(2 ** 53 === 2 ** 53 + 1).toBe(true)
    expect(paramSchemaOf(TRAINING_NUMBER_DEFS.seed).safeParse(MAX_SEED).success).toBe(true)
    expect(paramSchemaOf(TRAINING_NUMBER_DEFS.seed).safeParse(2 ** 53).success).toBe(false)
  })
})

describe('MODEL_NAME_PATTERN(C++ の validateModelName と同じ規則)', () => {
  it.each(['segnet', 'SegNet_v2', 'unet-3', '0'])('%s は使える', (name) => {
    expect(MODEL_NAME_PATTERN.test(name)).toBe(true)
  })

  it.each(['', 'seg net', 'a/b', '../evil', 'モデル', 'a.b'])('%j は使えない', (name) => {
    expect(MODEL_NAME_PATTERN.test(name)).toBe(false)
  })
})

describe('DEVICE_PATTERN(C++ の parseComputeDevice と同じ規則)', () => {
  it.each(['cpu', 'cuda', 'cuda:0', 'cuda:12'])('%s は受け付ける', (device) => {
    expect(DEVICE_PATTERN.test(device)).toBe(true)
  })

  it.each(['', 'gpu', 'cuda:', 'cuda:-1', 'cuda:a', 'CPU', 'cpu:0', ' cpu'])(
    '%j は受け付けない',
    (device) => {
      expect(DEVICE_PATTERN.test(device)).toBe(false)
    },
  )
})
