// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { TrainingProgress } from './progress'
import {
  TRAINING_STATUSES,
  TRAINING_STATUS_LABELS,
  appendLossPoint,
  isTerminalStatus,
} from './progress'

describe('isTerminalStatus', () => {
  it('完了・失敗・停止は終端(ストリームを閉じてよい)', () => {
    expect(isTerminalStatus('completed')).toBe(true)
    expect(isTerminalStatus('failed')).toBe(true)
    expect(isTerminalStatus('stopped')).toBe(true)
  })

  it('学習中・待機中は終端ではない', () => {
    expect(isTerminalStatus('running')).toBe(false)
    expect(isTerminalStatus('idle')).toBe(false)
  })
})

describe('TRAINING_STATUS_LABELS', () => {
  it('すべての状態に表示名がある', () => {
    for (const status of TRAINING_STATUSES) {
      expect(TRAINING_STATUS_LABELS[status]).not.toBe('')
    }
  })
})

describe('appendLossPoint', () => {
  const progress = (patch: Partial<TrainingProgress>): TrainingProgress => ({
    epoch: 1,
    trainLoss: 0.5,
    valLoss: 0.6,
    status: 'running',
    metrics: null,
    epochElapsedMs: 0,
    totalElapsedMs: 0,
    errorMessage: null,
    ...patch,
  })

  it('エポックの点を加える', () => {
    expect(appendLossPoint([], progress({}))).toEqual([{ epoch: 1, trainLoss: 0.5, valLoss: 0.6 }])
  })

  it('epoch 0 は描かない(学習の開始直後と、再開の直後)', () => {
    expect(appendLossPoint([], progress({ epoch: 0 }))).toEqual([])
  })

  it('同じエポックは置き換える(再接続や終了の通知で再び届くため)', () => {
    const points = appendLossPoint([], progress({ epoch: 1 }))
    const replaced = appendLossPoint(points, progress({ epoch: 1, trainLoss: 0.4 }))
    expect(replaced).toEqual([{ epoch: 1, trainLoss: 0.4, valLoss: 0.6 }])
  })

  it('エポックの順に保ち、飛びはそのまま残す', () => {
    const points = appendLossPoint(
      appendLossPoint([], progress({ epoch: 4 })),
      progress({ epoch: 2 }),
    )
    expect(points.map((point) => point.epoch)).toEqual([2, 4])
  })

  it('loss の null(NaN や inf)も点として残す', () => {
    expect(appendLossPoint([], progress({ trainLoss: null }))[0]?.trainLoss).toBeNull()
  })
})
