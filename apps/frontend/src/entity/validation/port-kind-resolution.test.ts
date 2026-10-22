// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { ModelGraph } from '../model-graph/model-graph'
import { nodeId } from '../model-graph/node-id'
import { GRAPH_INPUT, nodeOutput } from '../model-graph/port'
import { defaultNodeCatalog } from '../node-catalog/entries'

import { resolveOutputKind } from './port-kind-resolution'
import { buildGraph } from './test-fixtures'

const resolve = (graph: ModelGraph, from: string, port: string) =>
  resolveOutputKind(graph, defaultNodeCatalog, nodeOutput(nodeId(from), port))

describe('resolveOutputKind', () => {
  it('グラフ入力は特徴マップである', () => {
    expect(resolveOutputKind(buildGraph([]), defaultNodeCatalog, GRAPH_INPUT)).toBe('feature')
  })

  it('種類が決まっているポートはそのまま返す', () => {
    const graph = buildGraph([{ id: 'conv1', kind: 'conv2d', inputs: { x: 'graph-input' } }])
    expect(resolve(graph, 'conv1', 'y')).toBe('feature')
  })

  it('IndexedPooling の indices は indices である', () => {
    const graph = buildGraph([
      { id: 'pool1', kind: 'indexed_pooling', inputs: { x: 'graph-input' } },
    ])
    expect(resolve(graph, 'pool1', 'indices')).toBe('indices')
    expect(resolve(graph, 'pool1', 'y')).toBe('feature')
  })

  it('Any の出力は上流から決まる', () => {
    // Activation の x / y はどちらも Any。上流が特徴マップなら出力も特徴マップ
    const graph = buildGraph([
      { id: 'conv1', kind: 'conv2d', inputs: { x: 'graph-input' } },
      { id: 'relu1', kind: 'activation', inputs: { x: ['conv1', 'y'] } },
    ])
    expect(resolve(graph, 'relu1', 'y')).toBe('feature')
  })

  it('Any が何段続いても上流までたどる', () => {
    const graph = buildGraph([
      { id: 'pool1', kind: 'indexed_pooling', inputs: { x: 'graph-input' } },
      { id: 'a', kind: 'activation', inputs: { x: ['pool1', 'indices'] } },
      { id: 'b', kind: 'activation', inputs: { x: ['a', 'y'] } },
      { id: 'c', kind: 'activation', inputs: { x: ['b', 'y'] } },
    ])
    // 実体は indices のまま。これが分かるから Conv2D への接続を止められる
    expect(resolve(graph, 'c', 'y')).toBe('indices')
  })

  it('Concat の出力も入力から決まる', () => {
    const graph = buildGraph([
      { id: 'a', kind: 'conv2d', inputs: { x: 'graph-input' } },
      { id: 'b', kind: 'conv2d', inputs: { x: 'graph-input' } },
      {
        id: 'cat1',
        kind: 'concat',
        inputs: {
          x: [
            ['a', 'y'],
            ['b', 'y'],
          ],
        },
      },
    ])
    expect(resolve(graph, 'cat1', 'y')).toBe('feature')
  })

  it('Unpooling の indices 入力は出力の種類を決めない', () => {
    // indices ポートは Any ではないので、Any の解決には使われない。
    // x(特徴マップ)から決まる
    const graph = buildGraph([
      { id: 'pool1', kind: 'indexed_pooling', inputs: { x: 'graph-input' } },
      {
        id: 'unpool1',
        kind: 'unpooling',
        inputs: { x: ['pool1', 'y'], indices: ['pool1', 'indices'] },
      },
      { id: 'relu1', kind: 'activation', inputs: { x: ['unpool1', 'y'] } },
    ])
    expect(resolve(graph, 'relu1', 'y')).toBe('feature')
  })

  it('つながっていない Any は決められない', () => {
    const graph = buildGraph([{ id: 'relu1', kind: 'activation' }])
    expect(resolve(graph, 'relu1', 'y')).toBe('unknown')
  })

  it('存在しないノード・ポートは決められない', () => {
    const graph = buildGraph([{ id: 'conv1', kind: 'conv2d', inputs: { x: 'graph-input' } }])
    expect(resolve(graph, 'missing', 'y')).toBe('unknown')
    expect(resolve(graph, 'conv1', 'indices')).toBe('unknown')
  })

  it('閉路があっても止まらず unknown を返す', () => {
    const graph = buildGraph([
      { id: 'a', kind: 'activation', inputs: { x: ['b', 'y'] } },
      { id: 'b', kind: 'activation', inputs: { x: ['a', 'y'] } },
    ])
    expect(resolve(graph, 'a', 'y')).toBe('unknown')
  })

  it('分岐して合流する形(ダイヤモンド)でも解決できる', () => {
    // 同じノードを別経路からたどるとき、閉路と誤判定しないことの確認
    const graph = buildGraph([
      { id: 'conv1', kind: 'conv2d', inputs: { x: 'graph-input' } },
      { id: 'a', kind: 'activation', inputs: { x: ['conv1', 'y'] } },
      { id: 'b', kind: 'activation', inputs: { x: ['conv1', 'y'] } },
      {
        id: 'cat1',
        kind: 'concat',
        inputs: {
          x: [
            ['a', 'y'],
            ['b', 'y'],
          ],
        },
      },
    ])
    expect(resolve(graph, 'cat1', 'y')).toBe('feature')
  })
})
