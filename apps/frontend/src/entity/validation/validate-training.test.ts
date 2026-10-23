// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { defaultVariant, withVariantParams } from '../training/variant'
import { IMAGE_TASK_TYPES } from '../training/data-spec'
import { LOSS_TYPES } from '../training/loss'
import { OPTIMIZER_TYPES } from '../training/optimizer'
import type { TrainingSettings } from '../training/training-settings'
import { MAX_SEED, defaultTrainingSettings } from '../training/training-settings'

import type { Issue } from './issue'
import { validateTrainingSettings } from './validate-training'

/** 既定値に device を入れただけの、そのまま学習を始められる設定 */
function validSettings(patch: Partial<TrainingSettings> = {}): TrainingSettings {
  return {
    ...defaultTrainingSettings(),
    datasetPath: '/data/voc',
    device: 'cpu',
    ...patch,
  }
}

function issuesOf(
  settings: TrainingSettings,
  availableDevices?: readonly string[],
): readonly Issue[] {
  return validateTrainingSettings(
    availableDevices === undefined ? { settings } : { settings, availableDevices },
  ).issues
}

/** テストで見たいのは「どの項目に、どの種類の問題があるか」。文言には依存しない */
const summaryOf = (issues: readonly Issue[]): readonly string[] =>
  issues.map((issue) => `${issue.code} @ ${issue.field ?? ''}`)

describe('validateTrainingSettings - 全体', () => {
  it('既定値 + データセットのパス + device なら問題なし', () => {
    const result = validateTrainingSettings({ settings: validSettings() })
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('既定値のままでは、データセットのパスと device が足りない', () => {
    expect(summaryOf(issuesOf(defaultTrainingSettings()))).toEqual([
      'training/required @ dataset_path',
      'training/required @ device',
    ])
  })

  it('1 件目で打ち切らず、すべての問題を報告する', () => {
    const settings = validSettings({ modelName: '', epoch: 0, batch: 0 })
    expect(issuesOf(settings)).toHaveLength(3)
    expect(validateTrainingSettings({ settings }).ok).toBe(false)
  })
})

describe('model_name', () => {
  it('空なら必須の問題', () => {
    expect(summaryOf(issuesOf(validSettings({ modelName: '' })))).toEqual([
      'training/required @ model_name',
    ])
  })

  it('ファイル名に使えない文字があれば書式の問題(C++ と同じ規則)', () => {
    expect(summaryOf(issuesOf(validSettings({ modelName: 'seg/net' })))).toEqual([
      'training/invalid-format @ model_name',
    ])
  })
})

describe('dataset_path', () => {
  it('空白だけなら未入力とみなす', () => {
    expect(summaryOf(issuesOf(validSettings({ datasetPath: '   ' })))).toEqual([
      'training/required @ dataset_path',
    ])
  })
})

describe('device', () => {
  it('capabilities の一覧にあれば問題なし', () => {
    expect(issuesOf(validSettings({ device: 'cuda:0' }), ['cpu', 'cuda:0'])).toEqual([])
  })

  it('書式が正しくても、一覧になければ使えない(GPU が 1 枚のサーバーで cuda:1)', () => {
    const issues = issuesOf(validSettings({ device: 'cuda:1' }), ['cpu', 'cuda:0'])
    expect(summaryOf(issues)).toEqual(['training/unknown-device @ device'])
    // 何を選べばよいかが分かるよう、使えるデバイスをメッセージに含める
    expect(issues[0]?.message).toContain('cpu / cuda:0')
  })

  it('一覧がまだなければ、書式だけを確かめる', () => {
    expect(issuesOf(validSettings({ device: 'cuda:3' }))).toEqual([])
    expect(summaryOf(issuesOf(validSettings({ device: 'gpu0' })))).toEqual([
      'training/invalid-format @ device',
    ])
  })
})

describe('数値の項目', () => {
  it('epoch と batch は 1 以上', () => {
    expect(summaryOf(issuesOf(validSettings({ epoch: 0, batch: 0 })))).toEqual([
      'training/out-of-range @ epoch',
      'training/out-of-range @ batch',
    ])
  })

  it('epoch は整数', () => {
    expect(summaryOf(issuesOf(validSettings({ epoch: 1.5 })))).toEqual([
      'training/out-of-range @ epoch',
    ])
  })

  it('save_last_every は 0 を許す(0 = 毎エポック保存)', () => {
    expect(issuesOf(validSettings({ saveLastEvery: 0 }))).toEqual([])
    expect(summaryOf(issuesOf(validSettings({ saveLastEvery: -1 })))).toEqual([
      'training/out-of-range @ save_last_every',
    ])
  })

  it('seed は null(固定しない)も 0 も正しい値', () => {
    expect(issuesOf(validSettings({ seed: null }))).toEqual([])
    expect(issuesOf(validSettings({ seed: 0 }))).toEqual([])
  })

  it('seed は 0 以上 2^53 - 1 以下', () => {
    expect(issuesOf(validSettings({ seed: MAX_SEED }))).toEqual([])
    expect(summaryOf(issuesOf(validSettings({ seed: MAX_SEED + 1 })))).toEqual([
      'training/out-of-range @ seed.value',
    ])
    expect(summaryOf(issuesOf(validSettings({ seed: -1 })))).toEqual([
      'training/out-of-range @ seed.value',
    ])
  })

  it('NaN(入力欄を空にした場合など)は拒否する', () => {
    expect(summaryOf(issuesOf(validSettings({ batch: Number.NaN })))).toEqual([
      'training/out-of-range @ batch',
    ])
  })

  it('メッセージはカタログの表示名と制約から日本語で組み立てる', () => {
    const issues = issuesOf(validSettings({ epoch: 0 }))
    expect(issues[0]?.message).toBe('エポック数は整数(1 以上)にしてください。')
  })
})

describe('optimizer', () => {
  it('学習率 0 は拒否する(exclusiveMin: 0)', () => {
    const optimizer = withVariantParams(defaultVariant(OPTIMIZER_TYPES, 'adam'), {
      learning_rate: 0,
    })
    const issues = issuesOf(validSettings({ optimizer }))
    // field は C++ のエラーメッセージと同じ JSON 表記のパス
    expect(summaryOf(issues)).toEqual(['training/param-invalid @ optimizer.adam.learning_rate'])
    expect(issues[0]?.message).toContain('0 より大きい')
  })

  it('β1 = 1 は拒否する(exclusiveMax: 1)', () => {
    const optimizer = withVariantParams(defaultVariant(OPTIMIZER_TYPES, 'adam_w'), { beta1: 1 })
    expect(summaryOf(issuesOf(validSettings({ optimizer })))).toEqual([
      'training/param-invalid @ optimizer.adam_w.beta1',
    ])
  })

  it('定義にないパラメータを報告する', () => {
    const optimizer = withVariantParams(defaultVariant(OPTIMIZER_TYPES, 'sgd'), { eps: 1e-8 })
    expect(summaryOf(issuesOf(validSettings({ optimizer })))).toEqual([
      'training/param-unknown @ optimizer.sgd.eps',
    ])
  })

  it('足りないパラメータを報告する', () => {
    const optimizer = { kind: 'sgd' as const, params: { learning_rate: 0.01 } }
    expect(summaryOf(issuesOf(validSettings({ optimizer })))).toEqual([
      'training/param-missing @ optimizer.sgd.weight_decay',
      'training/param-missing @ optimizer.sgd.momentum',
      'training/param-missing @ optimizer.sgd.nesterov',
    ])
  })

  it('型の違う値を報告する(nesterov に数値)', () => {
    const optimizer = withVariantParams(defaultVariant(OPTIMIZER_TYPES, 'sgd'), { nesterov: 1 })
    expect(summaryOf(issuesOf(validSettings({ optimizer })))).toEqual([
      'training/param-invalid @ optimizer.sgd.nesterov',
    ])
  })
})

describe('loss', () => {
  it('パラメータのない loss はそのまま通る(MSE はタスクとの組み合わせで別に報告する)', () => {
    for (const kind of ['cross_entropy', 'dice', 'boundary'] as const) {
      expect(issuesOf(validSettings({ loss: defaultVariant(LOSS_TYPES, kind) }))).toEqual([])
    }
  })

  it('Combo の α は 0 以上 1 以下', () => {
    const loss = withVariantParams(defaultVariant(LOSS_TYPES, 'combo'), { alpha: 1.5 })
    expect(summaryOf(issuesOf(validSettings({ loss })))).toEqual([
      'training/param-invalid @ loss.combo.alpha',
    ])
  })
})

describe('data_spec', () => {
  it('入力画像の大きさは 1 以上', () => {
    const dataSpec = { ...validSettings().dataSpec, inputWidth: 0 }
    expect(summaryOf(issuesOf(validSettings({ dataSpec })))).toEqual([
      'training/out-of-range @ data_spec.image.input_width',
    ])
  })

  it('ignore_index は 0〜255', () => {
    const base = validSettings().dataSpec
    const dataSpec = { ...base, task: withVariantParams(base.task, { ignore_index: 256 }) }
    expect(summaryOf(issuesOf(validSettings({ dataSpec })))).toEqual([
      'training/param-invalid @ data_spec.image.task_specs.segmentation.ignore_index',
    ])
  })

  it('アノテーションのパラメータも確かめる', () => {
    const base = validSettings().dataSpec
    const dataSpec = { ...base, annotation: { kind: 'pascal_voc' as const, params: {} } }
    expect(summaryOf(issuesOf(validSettings({ dataSpec })))).toEqual([
      'training/param-missing @ data_spec.image.annotation.pascal_voc.include_difficult',
    ])
  })
})

describe('タスクと loss の組み合わせ(未決事項 1)', () => {
  const withTask = (kind: 'segmentation' | 'classification' | 'object_detection') => {
    const base = validSettings().dataSpec
    return { ...base, task: defaultVariant(IMAGE_TASK_TYPES, kind) }
  }

  it('学習エンジンが未対応のタスクは error', () => {
    const issues = issuesOf(validSettings({ dataSpec: withTask('classification') }))
    expect(summaryOf(issues)).toContain(
      'training/task-unavailable @ data_spec.image.task_specs.classification',
    )
    expect(issues[0]?.message).toContain('まだ対応していません')
  })

  it('セグメンテーションでは、MSE 以外の loss を使える', () => {
    for (const kind of ['cross_entropy', 'dice', 'focal', 'combo', 'boundary'] as const) {
      expect(issuesOf(validSettings({ loss: defaultVariant(LOSS_TYPES, kind) }))).toEqual([])
    }
  })

  it('MSE は今どのタスクでも使えない(正解がクラス番号で、形が合わない)', () => {
    const issues = issuesOf(validSettings({ loss: defaultVariant(LOSS_TYPES, 'mse') }))
    expect(summaryOf(issues)).toEqual(['training/loss-task-mismatch @ loss.mse'])
    expect(issues[0]?.message).toContain('今はどのタスクでも使えません')
  })

  it('組み合わせの不正は、使えるタスクを案内する', () => {
    const issues = issuesOf(
      validSettings({
        dataSpec: withTask('object_detection'),
        loss: defaultVariant(LOSS_TYPES, 'dice'),
      }),
    )
    const mismatch = issues.find((issue) => issue.code === 'training/loss-task-mismatch')
    expect(mismatch?.message).toContain('使えるタスク: セグメンテーション')
  })
})
