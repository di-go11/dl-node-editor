// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { TrainingSettings } from '../training/training-settings'
import { defaultTrainingSettings } from '../training/training-settings'

import { validateResumeSettings } from './validate-resume'

/** 前回 5 エポック完了したモデルを、合計 10 エポックまで続ける設定 */
function resumeSettings(patch: Partial<TrainingSettings> = {}): TrainingSettings {
  return {
    ...defaultTrainingSettings(),
    datasetPath: '/data/voc',
    device: 'cpu',
    epoch: 10,
    ...patch,
  }
}

const codesOf = (settings: TrainingSettings, completedEpochs = 5) =>
  validateResumeSettings({ settings, completedEpochs }).issues.map((issue) => issue.code)

describe('validateResumeSettings', () => {
  it('完了済みより大きい epoch なら問題なし', () => {
    expect(validateResumeSettings({ settings: resumeSettings(), completedEpochs: 5 }).ok).toBe(
      true,
    )
  })

  it.each([5, 3])('epoch が完了済みのエポック数以下(%i)なら止める', (epoch) => {
    const result = validateResumeSettings({
      settings: resumeSettings({ epoch }),
      completedEpochs: 5,
    })
    expect(result.ok).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'training/epoch-not-increased', field: 'epoch' }),
    )
    expect(result.issues[0]?.message).toContain('6 以上')
  })

  it('まだ 1 エポックも記録がなければ、epoch は 1 以上でよい', () => {
    expect(codesOf(resumeSettings({ epoch: 1 }), 0)).toEqual([])
  })

  it('変えられない項目(モデル名)は確かめない', () => {
    // 新規学習なら invalid-format になる名前でも、再開では前回の値なので止めない
    expect(codesOf(resumeSettings({ modelName: 'has space' }))).toEqual([])
  })

  it('変えられる項目(データセットのパス・デバイス)は確かめる', () => {
    expect(codesOf(resumeSettings({ datasetPath: '', device: '' }))).toEqual([
      'training/required',
      'training/required',
    ])
  })

  it('一覧にないデバイスは止める', () => {
    const result = validateResumeSettings({
      settings: resumeSettings({ device: 'cuda:0' }),
      completedEpochs: 5,
      availableDevices: ['cpu'],
    })
    expect(result.issues.map((issue) => issue.code)).toEqual(['training/unknown-device'])
  })
})
