// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { paramsSchemaOf } from '../node-catalog/param-def'

import { ANNOTATION_TYPES, IMAGE_TASK_TYPES } from './data-spec'
import { LOSS_TYPES } from './loss'
import { OPTIMIZER_TYPES } from './optimizer'
import type { VariantCatalog } from './variant'
import {
  changeVariantKind,
  defaultVariant,
  isVariantKind,
  variantDefOf,
  variantKindsOf,
  withVariantParams,
} from './variant'

describe('variantKindsOf', () => {
  it('カタログに宣言した順で返す(画面の選択肢の並び)', () => {
    expect(variantKindsOf(OPTIMIZER_TYPES)).toEqual(['adam', 'adam_w', 'sgd'])
    // loss は proto の oneof の番号順
    expect(variantKindsOf(LOSS_TYPES)).toEqual([
      'cross_entropy',
      'mse',
      'dice',
      'focal',
      'combo',
      'boundary',
    ])
  })
})

describe('isVariantKind', () => {
  it('カタログにある種類だけを受け付ける', () => {
    expect(isVariantKind(OPTIMIZER_TYPES, 'sgd')).toBe(true)
    expect(isVariantKind(OPTIMIZER_TYPES, 'rmsprop')).toBe(false)
  })

  it('プロトタイプ上の名前(toString など)を種類と誤認しない', () => {
    // `'toString' in catalog` は true になってしまう。自身のキーだけを見ていることの確認
    expect(isVariantKind(OPTIMIZER_TYPES, 'toString')).toBe(false)
    expect(isVariantKind(OPTIMIZER_TYPES, '__proto__')).toBe(false)
  })
})

describe('defaultVariant', () => {
  it('カタログの既定値でパラメータを埋める', () => {
    expect(defaultVariant(OPTIMIZER_TYPES, 'adam')).toEqual({
      kind: 'adam',
      params: { learning_rate: 1e-3, weight_decay: 0, beta1: 0.9, beta2: 0.999, eps: 1e-8 },
    })
  })

  it('パラメータのない種類は空の袋になる', () => {
    expect(defaultVariant(LOSS_TYPES, 'cross_entropy')).toEqual({
      kind: 'cross_entropy',
      params: {},
    })
  })
})

describe('changeVariantKind', () => {
  it('名前と型が同じパラメータは値を引き継ぐ', () => {
    const adam = withVariantParams(defaultVariant(OPTIMIZER_TYPES, 'adam'), {
      learning_rate: 0.05,
      weight_decay: 1e-4,
    })
    const sgd = changeVariantKind(OPTIMIZER_TYPES, adam, 'sgd')
    expect(sgd).toEqual({
      kind: 'sgd',
      // learning_rate と weight_decay は引き継ぎ、SGD にしかない項目は既定値
      params: { learning_rate: 0.05, weight_decay: 1e-4, momentum: 0.9, nesterov: false },
    })
  })

  it('切り替え先にないパラメータは捨てる', () => {
    const adam = defaultVariant(OPTIMIZER_TYPES, 'adam')
    const adamW = changeVariantKind(OPTIMIZER_TYPES, adam, 'adam_w')
    // eps は AdamW の定義にないので残さない(残すと C++ に送れない JSON になる)
    expect(Object.keys(adamW.params)).not.toContain('eps')
  })

  it('名前が同じでも型が違えば既定値に戻す', () => {
    const catalog = {
      a: { label: 'A', params: { size: { kind: 'int', label: 'size', default: 1 } } },
      b: {
        label: 'B',
        params: {
          size: {
            kind: 'enum',
            label: 'size',
            default: 'SMALL',
            options: [{ value: 'SMALL', label: 'S' }],
          },
        },
      },
    } satisfies VariantCatalog
    const next = changeVariantKind(catalog, { kind: 'a', params: { size: 5 } }, 'b')
    expect(next.params).toEqual({ size: 'SMALL' })
  })

  it('同じ種類を選び直しても値は変わらない', () => {
    const adam = withVariantParams(defaultVariant(OPTIMIZER_TYPES, 'adam'), { learning_rate: 0.5 })
    expect(changeVariantKind(OPTIMIZER_TYPES, adam, 'adam')).toBe(adam)
  })
})

/**
 * カタログの健全性。どの種類も「既定値のまま」で自分の制約を満たしていなければならない。
 * 満たさないと、選んだだけで検証エラーが出る(例: exclusiveMin: 0 なのに default: 0)。
 */
describe('バリアントカタログの既定値', () => {
  const catalogs: readonly (readonly [string, VariantCatalog])[] = [
    ['optimizer', OPTIMIZER_TYPES],
    ['loss', LOSS_TYPES],
    ['annotation', ANNOTATION_TYPES],
    ['task', IMAGE_TASK_TYPES],
  ]

  for (const [name, catalog] of catalogs) {
    for (const kind of variantKindsOf(catalog)) {
      it(`${name}.${kind} の既定値は自分の制約を満たす`, () => {
        const variant = defaultVariant(catalog, kind)
        const result = paramsSchemaOf(variantDefOf(catalog, kind).params).safeParse(variant.params)
        expect(result.error?.issues ?? []).toEqual([])
      })
    }
  }
})
