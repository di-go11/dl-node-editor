// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { NODE_KINDS } from '../../model-graph/node-spec'
import type { InputPortDef, NodeTypeDef, OutputPortDef } from '../node-type'
import {
  NODE_CATEGORY_LABELS,
  formatNodeSummary,
  summaryPlaceholdersOf,
  wireKindOf,
} from '../node-type'
import { defaultParamsOf, paramsSchemaOf } from '../../param/param-def'

import { DEFAULT_NODE_TYPES, conv2dType, defaultNodeCatalog } from './index'

/**
 * ## NodePorts.hpp との一致
 *
 * ポート定義の正本は C++ の
 * apps/backend/ai-engine/src/training/entities/domain-objects/ModelGraph/NodePorts.hpp である。
 * ずれると「フロントでは組めるのに学習開始で失敗する」という、最も見つけにくい
 * 種類の不具合になる。そこで下の表に NodePorts.hpp の nodePortsOf から転記し、
 * カタログと一致することを検査する。**C++ 側を直したらこの表も直す。**
 *
 * .hpp を正規表現で解析する方法も検討したが、C++ 側の整形が変わるとテストが
 * 不可解に壊れるため採らなかった。転記 + 由来コメントのほうが壊れ方が分かりやすい。
 *
 * 表記: 入力は `名前:種類:最低本数` で、複数つなげる(variadic)なら末尾に `*`。
 *       出力は `名前:種類`。
 */
const EXPECTED_PORTS: Readonly<
  Record<string, { readonly inputs: readonly string[]; readonly outputs: readonly string[] }>
> = {
  // nodePortsOf(const Conv2DSpec&)
  conv2d: { inputs: ['x:feature:1'], outputs: ['y:feature'] },
  // nodePortsOf(const PoolingSpec&) ... proto 側の名前は Pooling2DSpec
  pooling2d: { inputs: ['x:feature:1'], outputs: ['y:feature'] },
  // nodePortsOf(const BatchNormSpec&)
  batch_norm: { inputs: ['x:feature:1'], outputs: ['y:feature'] },
  // nodePortsOf(const LinearSpec&)
  linear: { inputs: ['x:feature:1'], outputs: ['y:feature'] },
  // nodePortsOf(const IndexedPoolingSpec&) ... 出力が 2 つ
  indexed_pooling: { inputs: ['x:feature:1'], outputs: ['y:feature', 'indices:indices'] },
  // nodePortsOf(const UnpoolingSpec&) ... 入力が 2 つ
  unpooling: { inputs: ['x:feature:1', 'indices:indices:1'], outputs: ['y:feature'] },
  // nodePortsOf(const ActivationSpec&) ... 種類は Any
  activation: { inputs: ['x:any:1'], outputs: ['y:any'] },
  // nodePortsOf(const AddSpec&) ... variadic / minCount 2
  add: { inputs: ['x:any:2*'], outputs: ['y:any'] },
  // nodePortsOf(const ConcatSpec&) ... variadic / minCount 2
  concat: { inputs: ['x:any:2*'], outputs: ['y:any'] },
  // nodePortsOf(const UpsampleSpec&)
  upsample: { inputs: ['x:feature:1'], outputs: ['y:feature'] },

  // --- エディタ専用(C++ には対応する定義がない) ---
  __input__: { inputs: [], outputs: ['y:feature'] },
  __output__: { inputs: ['x:any:1'], outputs: [] },
}

function formatInput(port: InputPortDef): string {
  return `${port.name}:${port.kind}:${port.minCount}${port.variadic ? '*' : ''}`
}

function formatOutput(port: OutputPortDef): string {
  return `${port.name}:${port.kind}`
}

describe('NodePorts.hpp との一致', () => {
  it('転記した表とカタログのノードが同じ集合である', () => {
    expect(DEFAULT_NODE_TYPES.map((def) => def.typeId).sort()).toEqual(
      Object.keys(EXPECTED_PORTS).sort(),
    )
  })

  it.each(DEFAULT_NODE_TYPES.map((def): [string, NodeTypeDef] => [def.typeId, def]))(
    '%s のポート定義が一致する',
    (typeId, def) => {
      const expected = EXPECTED_PORTS[typeId]
      expect(expected).toBeDefined()
      expect(def.inputs.map(formatInput)).toEqual(expected?.inputs)
      expect(def.outputs.map(formatOutput)).toEqual(expected?.outputs)
    },
  )
})

describe('カタログと proto の層の種類の対応', () => {
  it('proto のすべての層の種類に定義がある', () => {
    const wireKinds = DEFAULT_NODE_TYPES.map(wireKindOf).filter((kind) => kind !== null)
    expect(wireKinds.sort()).toEqual([...NODE_KINDS].sort())
  })

  it('エディタ専用のノードは proto の層の種類を持たない', () => {
    for (const def of DEFAULT_NODE_TYPES) {
      if (def.editorOnly) expect(wireKindOf(def)).toBeNull()
      else expect(wireKindOf(def)).toBe(def.typeId)
    }
  })

  it('エディタ専用のノードの typeId は予約 ID である', () => {
    const editorOnly = DEFAULT_NODE_TYPES.filter((def) => def.editorOnly)
    expect(editorOnly.map((def) => def.typeId).sort()).toEqual(['__input__', '__output__'])
  })
})

describe('定義の健全性', () => {
  it.each(DEFAULT_NODE_TYPES.map((def): [string, NodeTypeDef] => [def.typeId, def]))(
    '%s の既定値は自分の制約を満たす',
    (_typeId, def) => {
      // 既定値が制約違反だと、ノードを置いた瞬間からエラー表示になる
      const result = paramsSchemaOf(def.params).safeParse(defaultParamsOf(def.params))
      expect(result.error?.issues ?? []).toEqual([])
    },
  )

  it.each(DEFAULT_NODE_TYPES.map((def): [string, NodeTypeDef] => [def.typeId, def]))(
    '%s の要約表示は実在するパラメータだけを参照する',
    (_typeId, def) => {
      for (const name of summaryPlaceholdersOf(def)) {
        expect(Object.keys(def.params)).toContain(name)
      }
    },
  )

  it.each(DEFAULT_NODE_TYPES.map((def): [string, NodeTypeDef] => [def.typeId, def]))(
    '%s の enum の既定値は選択肢に含まれる',
    (_typeId, def) => {
      for (const paramDef of Object.values(def.params)) {
        if (paramDef.kind !== 'enum') continue
        expect(paramDef.options.map((option) => option.value)).toContain(paramDef.default)
      }
    },
  )

  it.each(DEFAULT_NODE_TYPES.map((def): [string, NodeTypeDef] => [def.typeId, def]))(
    '%s のカテゴリに表示用のラベルがある',
    (_typeId, def) => {
      expect(NODE_CATEGORY_LABELS[def.category]).toBeTruthy()
    },
  )

  it.each(DEFAULT_NODE_TYPES.map((def): [string, NodeTypeDef] => [def.typeId, def]))(
    '%s は少なくとも 1 つの条件で使える',
    (_typeId, def) => {
      expect(def.contexts.length).toBeGreaterThan(0)
    },
  )

  it('ポート名はノード内で重複しない', () => {
    for (const def of DEFAULT_NODE_TYPES) {
      expect(new Set(def.inputs.map((p) => p.name)).size).toBe(def.inputs.length)
      expect(new Set(def.outputs.map((p) => p.name)).size).toBe(def.outputs.length)
    }
  })

  it('variadic なポートの minCount は 2 以上である', () => {
    // 複数つなげるのに 1 本でよいなら variadic にする意味がない
    for (const def of DEFAULT_NODE_TYPES) {
      for (const port of def.inputs) {
        if (port.variadic) expect(port.minCount).toBeGreaterThanOrEqual(2)
      }
    }
  })
})

describe('formatNodeSummary', () => {
  it('パラメータを埋めて要約を作る', () => {
    expect(formatNodeSummary(conv2dType, defaultParamsOf(conv2dType.params))).toBe('3→64, k3')
  })

  it('enum は proto の名前ではなく表示用のラベルになる', () => {
    const pooling2d = defaultNodeCatalog.byTypeId.get('pooling2d')
    expect(pooling2d).toBeDefined()
    expect(
      formatNodeSummary(pooling2d!, { pooling_type: 'POOLING_TYPE_AVERAGE', kernel_size: 3 }),
    ).toBe('Average k3')
  })

  it('値のないパラメータは ? になる(編集中でも表示を壊さない)', () => {
    expect(formatNodeSummary(conv2dType, {})).toBe('?→?, k?')
  })

  it('要約の定義がないノードは空文字になる', () => {
    const concat = defaultNodeCatalog.byTypeId.get('concat')
    expect(concat).toBeDefined()
    expect(formatNodeSummary(concat!, {})).toBe('')
  })
})
