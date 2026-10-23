// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { TRAINING_STATUSES, TRAINING_STATUS_LABELS, isTerminalStatus } from './progress'

describe('isTerminalStatus', () => {
  it('完了・失敗・停止は終端(ストリームを閉じてよい)', () => {
    expect(isTerminalStatus('completed')).toBe(true)
    expect(isTerminalStatus('failed')).toBe(true)
    expect(isTerminalStatus('stopped')).toBe(true)
  })

  it('学習中・待機中・不明は終端ではない', () => {
    expect(isTerminalStatus('running')).toBe(false)
    expect(isTerminalStatus('idle')).toBe(false)
    expect(isTerminalStatus('unspecified')).toBe(false)
  })
})

describe('TRAINING_STATUS_LABELS', () => {
  it('すべての状態に表示名がある', () => {
    for (const status of TRAINING_STATUSES) {
      expect(TRAINING_STATUS_LABELS[status]).not.toBe('')
    }
  })
})
