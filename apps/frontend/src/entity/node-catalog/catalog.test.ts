// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  createNodeCatalog,
  findNodeType,
  nodeTypesForContext,
  placeableNodeTypes,
  placeableNodeTypesByCategory,
} from './catalog'
import { defaultNodeCatalog } from './entries'
import type { NodeTypeDef } from './node-type'
import { inputPort, outputPort } from './node-type'

function stub(typeId: 'conv2d' | 'linear', category: NodeTypeDef['category']): NodeTypeDef {
  return {
    editorOnly: false,
    typeId,
    label: typeId,
    category,
    inputs: [inputPort('x')],
    outputs: [outputPort('y')],
    params: {},
    contexts: [{ dataDim: '2d', method: 'cnn' }],
  }
}

describe('createNodeCatalog', () => {
  it('typeId の重複を例外にする', () => {
    // 黙って上書きすると「サイドバーには出るのに検証が別の定義を見ている」状態になる
    expect(() =>
      createNodeCatalog([stub('conv2d', 'convolution'), stub('conv2d', 'pooling')]),
    ).toThrow()
  })

  it('定義の並び順を保つ', () => {
    const catalog = createNodeCatalog([
      stub('linear', 'fully-connected'),
      stub('conv2d', 'convolution'),
    ])
    expect(catalog.types.map((def) => def.typeId)).toEqual(['linear', 'conv2d'])
  })
})

describe('findNodeType', () => {
  it('typeId で引ける', () => {
    expect(findNodeType(defaultNodeCatalog, 'conv2d')?.label).toBe('Conv2D')
  })

  it('エディタ専用のノードも引ける', () => {
    expect(findNodeType(defaultNodeCatalog, '__input__')?.label).toBe('Input')
  })

  it('知らない typeId では undefined', () => {
    expect(findNodeType(defaultNodeCatalog, 'bogus')).toBeUndefined()
  })
})

describe('nodeTypesForContext', () => {
  it('2D / CNN では MVP の 10 種類 + Input / Output が使える', () => {
    expect(nodeTypesForContext(defaultNodeCatalog, { dataDim: '2d', method: 'cnn' })).toHaveLength(
      12,
    )
  })

  it('1D / CNN では Input / Output だけになる(1D 用のノードは未実装)', () => {
    const types = nodeTypesForContext(defaultNodeCatalog, { dataDim: '1d', method: 'cnn' })
    expect(types.map((def) => def.typeId)).toEqual(['__input__', '__output__'])
  })

  it('2D / Transformer でも Input / Output だけになる(Transformer 用のノードは未実装)', () => {
    const types = nodeTypesForContext(defaultNodeCatalog, { dataDim: '2d', method: 'transformer' })
    expect(types.map((def) => def.typeId)).toEqual(['__input__', '__output__'])
  })
})

describe('placeableNodeTypes', () => {
  it('エディタ専用のノードを除く(サイドバーからドラッグで増やせてはいけない)', () => {
    const types = placeableNodeTypes(defaultNodeCatalog, { dataDim: '2d', method: 'cnn' })
    expect(types).toHaveLength(10)
    expect(types.map((def) => def.typeId)).not.toContain('__input__')
  })

  it('1D ではサイドバーに出すノードが 1 つもない(注意書きだけを出す)', () => {
    expect(placeableNodeTypes(defaultNodeCatalog, { dataDim: '1d', method: 'cnn' })).toEqual([])
  })
})

describe('placeableNodeTypesByCategory', () => {
  const groups = placeableNodeTypesByCategory(defaultNodeCatalog, { dataDim: '2d', method: 'cnn' })

  it('カテゴリの定義順に並ぶ(表示順が実行ごとに変わらない)', () => {
    expect(groups.map((group) => group.category)).toEqual([
      'convolution',
      'pooling',
      'normalization',
      'activation',
      'fully-connected',
      'upsample',
      'merge',
    ])
  })

  it('空のカテゴリは返さない', () => {
    // graph-io は editorOnly だけなので、サイドバーには現れない
    expect(groups.map((group) => group.category)).not.toContain('graph-io')
    for (const group of groups) expect(group.types.length).toBeGreaterThan(0)
  })

  it('表示用のラベルが付く', () => {
    expect(groups[0]?.label).toBe('畳み込み')
  })

  it('すべてのノードがどこかのカテゴリに入る', () => {
    const total = groups.reduce((sum, group) => sum + group.types.length, 0)
    expect(total).toBe(10)
  })
})
