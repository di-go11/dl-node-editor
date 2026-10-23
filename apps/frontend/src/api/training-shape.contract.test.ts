// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type {
  ANNOTATION_TYPES,
  DATA_SPEC_KINDS,
  IMAGE_TASK_TYPES,
} from '../entity/training/data-spec'
import type { LOSS_TYPES } from '../entity/training/loss'
import { OPTIMIZER_TYPES } from '../entity/training/optimizer'
import type { TRAINING_STATUS_JSON_VALUES } from '../entity/training/proto-json/schema'
import type {
  ImageSpecJson,
  StartTrainingRequestJson,
  StreamProgressJson,
  TrainingSettingsJson,
  classificationMetricsJsonSchema,
  segmentationMetricsJsonSchema,
} from '../entity/training/proto-json/schema'
import { variantKindsOf } from '../entity/training/variant'

import type { components } from './schema'

/**
 * 学習設定と進捗の、エンティティ層の定義と契約(openapi.yaml)の一致を検査する。
 *
 * 1b の node-catalog-params.contract.test.ts と同じ考え方である。
 * エンティティ層は生成型を参照しない(dependency-cruiser のルール)ので、
 * 「参照しないが、一致は検査する」接ぎ目をここに置く。
 *
 * 検査するもの:
 *   - optimizer / loss / annotation / task の種類名が、契約の oneof のキーと一致する
 *   - 各種類のパラメータ名が、契約の *Config / *Spec のキーと一致する
 *   - 学習設定・進捗の JSON のキーと、省略できるキーが契約と一致する
 *
 * 例えば optimizer に 'rmsprop' を足したのに契約を更新し忘れる、あるいは
 * learning_rate を lr と書き間違えると、ここが型エラーになる(tsc -b で検出される)。
 */

/** 2 つの型が厳密に等しいかを判定する型(model-graph-shape.contract.test.ts と同じ) */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/**
 * カタログのパラメータと契約のスキーマの、キーの一致を判定する型。
 *
 * パラメータのない種類(CrossEntropy など)は、契約では `properties: {}` で、
 * 生成型は Record<string, never> になる。この型の keyof は string なので、
 * 素直に keyof を比べると never(パラメータなし)と一致しない。
 * そこで「契約が空のオブジェクトなら、カタログのパラメータも空」という形に読み替える。
 */
type ParamKeysMatch<Params, Contract> =
  Contract extends Record<string, never>
    ? Equal<keyof Params, never>
    : Equal<keyof Params, keyof Contract>

/** 省略できる(? の付いた)キーだけを取り出す型 */
type OptionalKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? K : never
}[keyof T]

type Schemas = components['schemas']

describe('optimizer', () => {
  it('種類名が契約の OptimizerConfig のキーと一致する', () => {
    const matches: Equal<keyof typeof OPTIMIZER_TYPES, keyof Schemas['OptimizerConfig']> = true
    expect(matches).toBe(true)
    // 型だけでなく、実行時の並び(画面の選択肢)にも全種類が出ることを確かめる
    expect(variantKindsOf(OPTIMIZER_TYPES)).toHaveLength(3)
  })

  it('パラメータ名が AdamConfig / AdamWConfig / SGDConfig と一致する', () => {
    const adam: ParamKeysMatch<typeof OPTIMIZER_TYPES.adam.params, Schemas['AdamConfig']> = true
    const adamW: ParamKeysMatch<typeof OPTIMIZER_TYPES.adam_w.params, Schemas['AdamWConfig']> = true
    const sgd: ParamKeysMatch<typeof OPTIMIZER_TYPES.sgd.params, Schemas['SGDConfig']> = true
    expect([adam, adamW, sgd]).toEqual([true, true, true])
  })
})

describe('loss', () => {
  it('種類名が契約の LossConfig のキーと一致する', () => {
    const matches: Equal<keyof typeof LOSS_TYPES, keyof Schemas['LossConfig']> = true
    expect(matches).toBe(true)
  })

  it('パラメータ名が各 *Config と一致する(パラメータのない種類も含む)', () => {
    const results: readonly boolean[] = [
      true satisfies ParamKeysMatch<
        typeof LOSS_TYPES.cross_entropy.params,
        Schemas['CrossEntropyConfig']
      >,
      true satisfies ParamKeysMatch<typeof LOSS_TYPES.mse.params, Schemas['MseLossConfig']>,
      true satisfies ParamKeysMatch<typeof LOSS_TYPES.dice.params, Schemas['DiceLossConfig']>,
      true satisfies ParamKeysMatch<typeof LOSS_TYPES.focal.params, Schemas['FocalLossConfig']>,
      true satisfies ParamKeysMatch<typeof LOSS_TYPES.combo.params, Schemas['ComboLossConfig']>,
      true satisfies ParamKeysMatch<
        typeof LOSS_TYPES.boundary.params,
        Schemas['BoundaryLossConfig']
      >,
    ]
    expect(results.every(Boolean)).toBe(true)
  })

  it('ParamKeysMatch は、パラメータの有無の食い違いを見逃さない', () => {
    // 契約が空なのにカタログにパラメータがある / その逆、の両方が false になること
    const extra: ParamKeysMatch<typeof LOSS_TYPES.focal.params, Schemas['CrossEntropyConfig']> =
      false
    const missing: ParamKeysMatch<
      typeof LOSS_TYPES.cross_entropy.params,
      Schemas['FocalLossConfig']
    > = false
    expect([extra, missing]).toEqual([false, false])
  })
})

describe('data_spec', () => {
  it('データの種類が契約の DataSpec のキーと一致する', () => {
    const matches: Equal<(typeof DATA_SPEC_KINDS)[number], keyof Schemas['DataSpec']> = true
    expect(matches).toBe(true)
  })

  it('ImageSpec のキーが一致する', () => {
    const matches: Equal<keyof ImageSpecJson, keyof Schemas['ImageSpec']> = true
    expect(matches).toBe(true)
  })

  it('アノテーションの種類とパラメータが一致する', () => {
    const kinds: Equal<keyof typeof ANNOTATION_TYPES, keyof Schemas['ImageAnnotationConfig']> = true
    const pascalVoc: ParamKeysMatch<
      typeof ANNOTATION_TYPES.pascal_voc.params,
      Schemas['PascalVocConfig']
    > = true
    expect([kinds, pascalVoc]).toEqual([true, true])
  })

  it('タスクの種類とパラメータが一致する', () => {
    const kinds: Equal<keyof typeof IMAGE_TASK_TYPES, keyof Schemas['ImageTaskSpecs']> = true
    const results: readonly boolean[] = [
      kinds,
      true satisfies ParamKeysMatch<
        typeof IMAGE_TASK_TYPES.segmentation.params,
        Schemas['SegmentationSpec']
      >,
      true satisfies ParamKeysMatch<
        typeof IMAGE_TASK_TYPES.object_detection.params,
        Schemas['ObjectDetectionSpec']
      >,
      true satisfies ParamKeysMatch<
        typeof IMAGE_TASK_TYPES.classification.params,
        Schemas['ClassificationSpec']
      >,
    ]
    expect(results.every(Boolean)).toBe(true)
  })
})

describe('学習開始リクエスト', () => {
  type Request = Schemas['StartTrainingRequest']

  it('学習設定のキーが、StartTrainingRequest から model_graph を除いたものと一致する', () => {
    const matches: Equal<keyof TrainingSettingsJson, Exclude<keyof Request, 'model_graph'>> = true
    expect(matches).toBe(true)
  })

  it('リクエスト全体のキーが一致する', () => {
    const matches: Equal<keyof StartTrainingRequestJson, keyof Request> = true
    expect(matches).toBe(true)
  })

  it('省略できるキー(seed だけ)が一致する', () => {
    const matches: Equal<OptionalKeys<StartTrainingRequestJson>, OptionalKeys<Request>> = true
    const onlySeed: Equal<OptionalKeys<StartTrainingRequestJson>, 'seed'> = true
    expect([matches, onlySeed]).toEqual([true, true])
  })
})

describe('進捗', () => {
  type Progress = Schemas['StreamProgressResponse']

  it('学習の状態の名前が契約の TrainingStatus と一致する', () => {
    const matches: Equal<(typeof TRAINING_STATUS_JSON_VALUES)[number], Schemas['TrainingStatus']> =
      true
    expect(matches).toBe(true)
  })

  it('StreamProgressResponse のキーと、省略できるキーが一致する', () => {
    const keys: Equal<keyof StreamProgressJson, keyof Progress> = true
    const optional: Equal<OptionalKeys<StreamProgressJson>, OptionalKeys<Progress>> = true
    expect([keys, optional]).toEqual([true, true])
  })

  it('メトリクスのキーが一致する', () => {
    type Segmentation = ReturnType<(typeof segmentationMetricsJsonSchema)['parse']>
    type Classification = ReturnType<(typeof classificationMetricsJsonSchema)['parse']>
    const segmentation: Equal<keyof Segmentation, keyof Schemas['SegmentationMetrics']> = true
    const classification: Equal<keyof Classification, keyof Schemas['ClassificationMetrics']> = true
    const oneof: Equal<'segmentation' | 'classification', keyof Schemas['ProgressMetrics']> = true
    expect([segmentation, classification, oneof]).toEqual([true, true, true])
  })
})
