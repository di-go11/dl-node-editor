// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { EnumParamDef, ParamDefs } from './param-def'
import {
  defaultParamsOf,
  describeParamConstraint,
  enumLabelOf,
  paramSchemaOf,
  paramsSchemaOf,
} from './param-def'

describe('paramSchemaOf - int', () => {
  const def = { kind: 'int', label: 'k', default: 3, min: 1, max: 9 } as const

  it('制約を満たす整数を受け付ける', () => {
    expect(paramSchemaOf(def).safeParse(3).success).toBe(true)
  })

  it('小数を拒否する', () => {
    expect(paramSchemaOf(def).safeParse(3.5).success).toBe(false)
  })

  it('min / max の外を拒否する', () => {
    expect(paramSchemaOf(def).safeParse(0).success).toBe(false)
    expect(paramSchemaOf(def).safeParse(10).success).toBe(false)
  })

  it('min を省いた定義では下限を課さない', () => {
    const noMin = { kind: 'int', label: 'dim', default: 1 } as const
    expect(paramSchemaOf(noMin).safeParse(-1).success).toBe(true)
  })
})

describe('paramSchemaOf - float', () => {
  it('exclusiveMin はその値そのものを拒否する', () => {
    // eps > 0 のような制約。min(0) だと 0 を通してしまい 0 除算が起きる
    const def = { kind: 'float', label: 'eps', default: 1e-5, exclusiveMin: 0 } as const
    expect(paramSchemaOf(def).safeParse(0).success).toBe(false)
    expect(paramSchemaOf(def).safeParse(1e-8).success).toBe(true)
  })

  it('min はその値を許す', () => {
    const def = { kind: 'float', label: 'momentum', default: 0.1, min: 0, max: 1 } as const
    expect(paramSchemaOf(def).safeParse(0).success).toBe(true)
    expect(paramSchemaOf(def).safeParse(1).success).toBe(true)
    expect(paramSchemaOf(def).safeParse(1.1).success).toBe(false)
  })

  it('整数でなくてよい', () => {
    const def = { kind: 'float', label: 'alpha', default: 1 } as const
    expect(paramSchemaOf(def).safeParse(0.75).success).toBe(true)
  })
})

describe('paramSchemaOf - bool / enum', () => {
  it('bool は真偽値だけを受け付ける', () => {
    const def = { kind: 'bool', label: 'bias', default: true } as const
    expect(paramSchemaOf(def).safeParse(false).success).toBe(true)
    expect(paramSchemaOf(def).safeParse('true').success).toBe(false)
  })

  it('enum は選択肢に含まれる値だけを受け付ける', () => {
    const def: EnumParamDef = {
      kind: 'enum',
      label: '種類',
      default: 'A',
      options: [
        { value: 'A', label: 'Alpha' },
        { value: 'B', label: 'Beta' },
      ],
    }
    expect(paramSchemaOf(def).safeParse('B').success).toBe(true)
    expect(paramSchemaOf(def).safeParse('C').success).toBe(false)
  })

  it('enum のエラーメッセージに選べる値が並ぶ', () => {
    const def: EnumParamDef = {
      kind: 'enum',
      label: '種類',
      default: 'A',
      options: [
        { value: 'A', label: 'Alpha' },
        { value: 'B', label: 'Beta' },
      ],
    }
    const result = paramSchemaOf(def).safeParse('C')
    expect(result.error?.issues[0]?.message).toContain('A / B')
  })
})

describe('paramsSchemaOf', () => {
  const defs: ParamDefs = {
    kernel_size: { kind: 'int', label: 'k', default: 3, min: 1 },
    bias: { kind: 'bool', label: 'bias', default: true },
  }

  it('すべてのパラメータがそろっていれば通る', () => {
    expect(paramsSchemaOf(defs).safeParse({ kernel_size: 3, bias: false }).success).toBe(true)
  })

  it('足りないパラメータを検出する', () => {
    const result = paramsSchemaOf(defs).safeParse({ kernel_size: 3 })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['bias'])
  })

  it('定義にないパラメータを拒否する(綴り間違いの検出)', () => {
    const result = paramsSchemaOf(defs).safeParse({ kernel_size: 3, bias: true, kernelSize: 3 })
    expect(result.success).toBe(false)
  })

  it('問題のあるパラメータの位置が分かる(Issue に変換して表示するため)', () => {
    const result = paramsSchemaOf(defs).safeParse({ kernel_size: 0, bias: true })
    expect(result.error?.issues[0]?.path).toEqual(['kernel_size'])
  })
})

describe('defaultParamsOf', () => {
  it('定義の既定値を集めて返す', () => {
    const defs: ParamDefs = {
      kernel_size: { kind: 'int', label: 'k', default: 3, min: 1 },
      mode: {
        kind: 'enum',
        label: 'mode',
        default: 'A',
        options: [{ value: 'A', label: 'Alpha' }],
      },
    }
    expect(defaultParamsOf(defs)).toEqual({ kernel_size: 3, mode: 'A' })
  })

  it('パラメータのない定義では空になる', () => {
    expect(defaultParamsOf({})).toEqual({})
  })
})

describe('enumLabelOf', () => {
  const def: EnumParamDef = {
    kind: 'enum',
    label: '種類',
    default: 'ACTIVATION_TYPE_RELU',
    options: [{ value: 'ACTIVATION_TYPE_RELU', label: 'ReLU' }],
  }

  it('proto の名前を表示用のラベルに直す', () => {
    expect(enumLabelOf(def, 'ACTIVATION_TYPE_RELU')).toBe('ReLU')
  })

  it('知らない値は値そのものを返す(表示を壊さない)', () => {
    expect(enumLabelOf(def, 'ACTIVATION_TYPE_UNKNOWN')).toBe('ACTIVATION_TYPE_UNKNOWN')
  })
})

describe('describeParamConstraint', () => {
  it('数値の制約を日本語にする', () => {
    expect(describeParamConstraint({ kind: 'int', label: 'k', default: 3, min: 1 })).toBe('1 以上')
    expect(
      describeParamConstraint({ kind: 'float', label: 'm', default: 0.1, min: 0, max: 1 }),
    ).toBe('0 以上、1 以下')
    expect(
      describeParamConstraint({ kind: 'float', label: 'eps', default: 1e-5, exclusiveMin: 0 }),
    ).toBe('0 より大きい')
  })

  it('制約のない定義では undefined', () => {
    expect(describeParamConstraint({ kind: 'int', label: 'dim', default: 1 })).toBeUndefined()
    expect(describeParamConstraint({ kind: 'bool', label: 'bias', default: true })).toBeUndefined()
  })

  it('enum は選べるラベルを並べる', () => {
    expect(
      describeParamConstraint({
        kind: 'enum',
        label: 'mode',
        default: 'A',
        options: [
          { value: 'A', label: 'Alpha' },
          { value: 'B', label: 'Beta' },
        ],
      }),
    ).toBe('Alpha / Beta')
  })
})
