// @vitest-environment node
import { describe, expect, it } from 'vitest'

// Vite の ?raw でファイルの中身を文字列として読み込む(src/api/schema.contract.test.ts と同じ手)
import exampleRaw from '../../../../../backend/ai-engine/modelconfigs/test_segnet_dag.json?raw'
import { defaultTrainingSettings } from '../training-settings'

import {
  fromStartTrainingRequestJson,
  toStartTrainingRequestJson,
  trainingSettingsFromJson,
  trainingSettingsToJson,
} from './convert'
import { startTrainingRequestJsonSchema, trainingSettingsJsonSchema } from './schema'

/**
 * フェーズ1d の完了条件:
 * 「test_segnet_dag.json 全体(model_graph を含む)を読み込んで書き戻すと、同じ内容になる」
 *
 * 1a の往復テストは model_graph だけだった。ここでは optimizer / loss / data_spec / seed
 * まで含めたファイル全体で、JSON → エンティティ → JSON の変換が情報を失わないことを確かめる。
 */

function parseExample(): unknown {
  return JSON.parse(exampleRaw)
}

describe('startTrainingRequestJsonSchema', () => {
  it('test_segnet_dag.json 全体を受け付ける', () => {
    const result = startTrainingRequestJsonSchema.safeParse(parseExample())
    expect(result.error?.issues ?? []).toEqual([])
    expect(result.success).toBe(true)
  })
})

describe('学習開始リクエストの往復', () => {
  it('test_segnet_dag.json を読み込んで書き戻すと同じ内容になる', () => {
    const json = startTrainingRequestJsonSchema.parse(parseExample())
    const { graph, settings } = fromStartTrainingRequestJson(json)
    expect(toStartTrainingRequestJson(graph, settings)).toEqual(parseExample())
  })

  it('キーの並びまで元のファイルと一致する(目で比べやすい出力になっている)', () => {
    const json = startTrainingRequestJsonSchema.parse(parseExample())
    const { graph, settings } = fromStartTrainingRequestJson(json)
    // toEqual はキーの順序を見ないので、文字列にして比べる
    expect(JSON.stringify(toStartTrainingRequestJson(graph, settings))).toBe(
      JSON.stringify(parseExample()),
    )
  })

  it('エンティティの型では camelCase とバリアントになる', () => {
    const json = startTrainingRequestJsonSchema.parse(parseExample())
    const { settings } = fromStartTrainingRequestJson(json)
    expect(settings).toMatchObject({
      modelName: 'test_segnet',
      optimizer: { kind: 'adam', params: { learning_rate: 0.001, eps: 1e-8 } },
      loss: { kind: 'cross_entropy', params: {} },
      datasetPath: '/workspaces/apps/backend/ai-engine/TrainingDataset/',
      device: 'cuda:0',
      dataSpec: {
        kind: 'image',
        task: { kind: 'segmentation', params: { ignore_index: 255 } },
      },
      // { "value": 0 } は「0 に固定する」であり、未指定(null)とは違う
      seed: 0,
    })
  })
})

describe('学習設定の往復', () => {
  it('既定値の学習設定を JSON にして戻すと同じになる', () => {
    const settings = defaultTrainingSettings()
    const json = trainingSettingsJsonSchema.parse(trainingSettingsToJson(settings))
    expect(trainingSettingsFromJson(json)).toEqual(settings)
  })

  it('seed が null なら、JSON では seed のキーごと省く', () => {
    const json = trainingSettingsToJson({ ...defaultTrainingSettings(), seed: null })
    expect(Object.hasOwn(json, 'seed')).toBe(false)
  })

  it('seed が 0 なら { value: 0 } を書く(未指定と区別する)', () => {
    const json = trainingSettingsToJson({ ...defaultTrainingSettings(), seed: 0 })
    expect(json.seed).toEqual({ value: 0 })
  })

  it('JSON のパラメータを書き換えても、元のエンティティに影響しない', () => {
    const settings = defaultTrainingSettings()
    const json = trainingSettingsToJson(settings)
    const adam = json.optimizer.adam
    if (adam === undefined) throw new Error('adam がありません')
    adam.learning_rate = 123
    expect(settings.optimizer.params.learning_rate).toBe(1e-3)
  })
})

describe('trainingSettingsJsonSchema(構造だけを検証する)', () => {
  const validJson = (): Record<string, unknown> => ({
    ...trainingSettingsToJson(defaultTrainingSettings()),
  })

  it('optimizer に種類が 2 つあれば拒否する(proto の oneof)', () => {
    const json = { ...validJson(), optimizer: { adam: {}, sgd: {} } }
    const result = trainingSettingsJsonSchema.safeParse(json)
    expect(result.success).toBe(false)
    // abort: true により、「種類が不明」は重ねて報告しない
    expect(result.error?.issues).toHaveLength(1)
  })

  it('知らない optimizer は拒否する', () => {
    const json = { ...validJson(), optimizer: { rmsprop: { learning_rate: 0.01 } } }
    expect(trainingSettingsJsonSchema.safeParse(json).success).toBe(false)
  })

  it('知らないデータの種類は拒否する(strictObject)', () => {
    const json = { ...validJson(), data_spec: { sequence: {} } }
    expect(trainingSettingsJsonSchema.safeParse(json).success).toBe(false)
  })

  it('値の制約は見ない(epoch = 0 でも読める。報告は検証層の仕事)', () => {
    const json = { ...validJson(), epoch: 0 }
    expect(trainingSettingsJsonSchema.safeParse(json).success).toBe(true)
  })
})
