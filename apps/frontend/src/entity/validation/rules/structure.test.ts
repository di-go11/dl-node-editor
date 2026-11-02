// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { emptyModelGraph } from '../../model-graph/model-graph'
import { nodeId } from '../../model-graph/node-id'
import { nodeOutput } from '../../model-graph/port'
import { buildGraph, validSegnetGraph, validationInput } from '../test-fixtures'

import { validateAcyclic, validateGraphIo, validateNodeIds, validateReferences } from './structure'

const codesOf = (issues: readonly { code: string }[]): readonly string[] =>
  issues.map((issue) => issue.code)

describe('validateNodeIds', () => {
  it('正しいグラフでは何も報告しない', () => {
    expect(validateNodeIds(validationInput(validSegnetGraph()))).toEqual([])
  })

  it('ID の重複を報告する', () => {
    // 同じ ID のノードが 2 つある状態。proto が禁じている
    const graph = buildGraph([
      { id: 'conv1', kind: 'conv2d', inputs: { x: 'graph-input' } },
      { id: 'conv1', kind: 'conv2d', inputs: { x: 'graph-input' } },
    ])
    const issues = validateNodeIds(validationInput(graph))
    expect(codesOf(issues)).toEqual(['node-id/duplicate'])
    expect(issues[0]?.nodeId).toBe('conv1')
  })
})

describe('validateGraphIo', () => {
  it('正しいグラフでは何も報告しない', () => {
    expect(validateGraphIo(validationInput(validSegnetGraph()))).toEqual([])
  })

  it('ノードが 1 つもなければ報告し、そこで打ち切る', () => {
    // 入口も出口もないのは当然なので、原因だけを 1 件報告する
    const issues = validateGraphIo(validationInput(emptyModelGraph()))
    expect(codesOf(issues)).toEqual(['graph/no-nodes'])
  })

  it('グラフ入力につながるノードがなければ報告する', () => {
    const graph = buildGraph([{ id: 'conv1', kind: 'conv2d' }], [['conv1', 'y']])
    expect(codesOf(validateGraphIo(validationInput(graph)))).toEqual(['graph/no-input'])
  })

  it('出力がなければ報告する', () => {
    const graph = buildGraph([{ id: 'conv1', kind: 'conv2d', inputs: { x: 'graph-input' } }])
    expect(codesOf(validateGraphIo(validationInput(graph)))).toEqual(['graph/no-output'])
  })

  it('出力が 2 つ以上なら報告する(当面 1 つだけ)', () => {
    const graph = buildGraph(
      [
        { id: 'conv1', kind: 'conv2d', inputs: { x: 'graph-input' } },
        { id: 'conv2', kind: 'conv2d', inputs: { x: 'graph-input' } },
      ],
      [
        ['conv1', 'y'],
        ['conv2', 'y'],
      ],
    )
    expect(codesOf(validateGraphIo(validationInput(graph)))).toEqual(['graph/multiple-outputs'])
  })
})

describe('validateAcyclic', () => {
  it('正しいグラフでは何も報告しない', () => {
    expect(validateAcyclic(validationInput(validSegnetGraph()))).toEqual([])
  })

  it('閉路を経路付きで報告する', () => {
    const graph = buildGraph([
      { id: 'a', kind: 'conv2d', inputs: { x: ['b', 'y'] } },
      { id: 'b', kind: 'conv2d', inputs: { x: ['a', 'y'] } },
    ])
    const issues = validateAcyclic(validationInput(graph))
    expect(codesOf(issues)).toEqual(['graph/cycle'])
    // どこが循環しているかを直せるよう、経路をメッセージに出す
    expect(issues[0]?.message).toContain('a → b → a')
  })
})

describe('validateReferences', () => {
  it('正しいグラフでは何も報告しない', () => {
    expect(validateReferences(validationInput(validSegnetGraph()))).toEqual([])
  })

  it('存在しないノードへの参照を報告する', () => {
    const graph = buildGraph([{ id: 'conv1', kind: 'conv2d', inputs: { x: ['missing', 'y'] } }])
    const issues = validateReferences(validationInput(graph))
    expect(codesOf(issues)).toEqual(['reference/missing-node'])
    expect(issues[0]).toMatchObject({ nodeId: 'conv1', port: 'x' })
  })

  it('存在しない出力ポートへの参照を報告する', () => {
    // Pooling2D に indices 出力はない(IndexedPooling から差し替えた状態)
    const graph = buildGraph([
      { id: 'pool1', kind: 'pooling2d', inputs: { x: 'graph-input' } },
      {
        id: 'unpool1',
        kind: 'unpooling',
        inputs: { x: ['pool1', 'y'], indices: ['pool1', 'indices'] },
      },
    ])
    const issues = validateReferences(validationInput(graph))
    expect(codesOf(issues)).toEqual(['reference/unknown-port'])
    // 何が使えるかをメッセージに出し、次の操作が分かるようにする
    expect(issues[0]?.message).toContain('使えるのは y')
  })

  it('モデルの出力が存在しないノードを指していたら報告する', () => {
    const graph = {
      ...buildGraph([{ id: 'conv1', kind: 'conv2d', inputs: { x: 'graph-input' } }]),
      outputs: [nodeOutput(nodeId('missing'), 'y')],
    }
    expect(codesOf(validateReferences(validationInput(graph)))).toEqual(['reference/missing-node'])
  })

  it('モデルの出力が存在しないポートを指していたら報告する', () => {
    const graph = {
      ...buildGraph([{ id: 'conv1', kind: 'conv2d', inputs: { x: 'graph-input' } }]),
      outputs: [nodeOutput(nodeId('conv1'), 'indices')],
    }
    expect(codesOf(validateReferences(validationInput(graph)))).toEqual(['reference/unknown-port'])
  })
})
