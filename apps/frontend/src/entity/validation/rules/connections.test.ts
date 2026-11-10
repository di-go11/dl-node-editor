// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { buildGraph, validSegnetGraph, validationInput } from '../test-fixtures'

import { validateInputArity, validatePortKinds } from './connections'

const codesOf = (issues: readonly { code: string }[]): readonly string[] =>
  issues.map((issue) => issue.code)

describe('validateInputArity', () => {
  it('正しいグラフでは何も報告しない', () => {
    expect(validateInputArity(validationInput(validSegnetGraph()))).toEqual([])
  })

  it('未接続の入力ポートを報告する', () => {
    const graph = buildGraph([{ id: 'conv1', kind: 'conv2d' }])
    const issues = validateInputArity(validationInput(graph))
    expect(codesOf(issues)).toEqual(['port/not-connected'])
    expect(issues[0]).toMatchObject({ nodeId: 'conv1', port: 'x' })
  })

  it('Unpooling は入力ポートが 2 つあるので、片方だけでも報告する', () => {
    const graph = buildGraph([
      { id: 'pool1', kind: 'indexed_pooling', inputs: { x: 'graph-input' } },
      { id: 'unpool1', kind: 'unpooling', inputs: { x: ['pool1', 'y'] } },
    ])
    const issues = validateInputArity(validationInput(graph))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'port/not-connected', port: 'indices' })
  })

  it('複数つなげないポートに 2 本つないだら報告する', () => {
    const graph = buildGraph([
      { id: 'a', kind: 'conv2d', inputs: { x: 'graph-input' } },
      { id: 'b', kind: 'conv2d', inputs: { x: 'graph-input' } },
      {
        id: 'bn1',
        kind: 'batch_norm',
        inputs: {
          x: [
            ['a', 'y'],
            ['b', 'y'],
          ],
        },
      },
    ])
    const issues = validateInputArity(validationInput(graph))
    expect(codesOf(issues)).toEqual(['port/too-many-connections'])
  })

  it('Concat に 1 本しかつないでいなければ報告する(minCount 2)', () => {
    // NodePorts.hpp が minCount 2 と定めている。1 本では結合する意味がない
    const graph = buildGraph([
      { id: 'a', kind: 'conv2d', inputs: { x: 'graph-input' } },
      { id: 'cat1', kind: 'concat', inputs: { x: ['a', 'y'] } },
    ])
    const issues = validateInputArity(validationInput(graph))
    expect(codesOf(issues)).toEqual(['port/too-few-connections'])
    expect(issues[0]?.message).toContain('2 本以上')
  })

  it('Concat に 2 本つないでいれば報告しない', () => {
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
    expect(validateInputArity(validationInput(graph))).toEqual([])
  })

  it('Add に 3 本つないでも報告しない(variadic に上限はない)', () => {
    const graph = buildGraph([
      { id: 'a', kind: 'conv2d', inputs: { x: 'graph-input' } },
      { id: 'b', kind: 'conv2d', inputs: { x: 'graph-input' } },
      { id: 'c', kind: 'conv2d', inputs: { x: 'graph-input' } },
      {
        id: 'add1',
        kind: 'add',
        inputs: {
          x: [
            ['a', 'y'],
            ['b', 'y'],
            ['c', 'y'],
          ],
        },
      },
    ])
    expect(validateInputArity(validationInput(graph))).toEqual([])
  })

  it('定義にないポートへの接続を報告する', () => {
    const graph = buildGraph([
      { id: 'a', kind: 'conv2d', inputs: { x: 'graph-input' } },
      // Conv2D に indices 入力はない
      { id: 'conv2', kind: 'conv2d', inputs: { x: ['a', 'y'], indices: ['a', 'y'] } },
    ])
    const issues = validateInputArity(validationInput(graph))
    expect(codesOf(issues)).toEqual(['port/unknown-input'])
    expect(issues[0]?.message).toContain('使えるのは x')
  })

  it('同じ不明ポートに 2 本つながっていても 1 件だけ報告する', () => {
    const graph = buildGraph([
      { id: 'a', kind: 'conv2d', inputs: { x: 'graph-input' } },
      {
        id: 'conv2',
        kind: 'conv2d',
        inputs: {
          x: ['a', 'y'],
          bogus: [
            ['a', 'y'],
            ['a', 'y'],
          ],
        },
      },
    ])
    expect(codesOf(validateInputArity(validationInput(graph)))).toEqual(['port/unknown-input'])
  })
})

describe('validatePortKinds', () => {
  it('正しいグラフでは何も報告しない', () => {
    expect(validatePortKinds(validationInput(validSegnetGraph()))).toEqual([])
  })

  it('indices を特徴マップのポートにつないだら報告する', () => {
    // indices は Unpooling の indices 以外につなげない
    const graph = buildGraph([
      { id: 'pool1', kind: 'indexed_pooling', inputs: { x: 'graph-input' } },
      { id: 'conv2', kind: 'conv2d', inputs: { x: ['pool1', 'indices'] } },
    ])
    const issues = validatePortKinds(validationInput(graph))
    expect(codesOf(issues)).toEqual(['port/kind-mismatch'])
    expect(issues[0]?.message).toContain('プーリングの位置情報')
  })

  it('特徴マップを indices のポートにつないだら報告する', () => {
    const graph = buildGraph([
      { id: 'pool1', kind: 'indexed_pooling', inputs: { x: 'graph-input' } },
      {
        id: 'unpool1',
        kind: 'unpooling',
        // indices に y(特徴マップ)をつないでしまった
        inputs: { x: ['pool1', 'y'], indices: ['pool1', 'y'] },
      },
    ])
    expect(codesOf(validatePortKinds(validationInput(graph)))).toEqual(['port/kind-mismatch'])
  })

  it('Any のポートを経由した indices も検出する(上流をたどって解決する)', () => {
    // Activation のポートは Any なので、局所的な比較では indices を通してしまう。
    // 上流まで解決して初めて「実体は indices」と分かる
    const graph = buildGraph([
      { id: 'pool1', kind: 'indexed_pooling', inputs: { x: 'graph-input' } },
      { id: 'relu1', kind: 'activation', inputs: { x: ['pool1', 'indices'] } },
      { id: 'conv2', kind: 'conv2d', inputs: { x: ['relu1', 'y'] } },
    ])
    const issues = validatePortKinds(validationInput(graph))
    // Activation 自身(indices を Any で受けた)と Conv2D(indices を受けた)の 2 件
    expect(codesOf(issues)).toEqual(['port/kind-mismatch', 'port/kind-mismatch'])
    expect(issues.map((issue) => issue.nodeId)).toEqual(['relu1', 'conv2'])
  })

  it('Any 同士は特徴マップとして通る', () => {
    const graph = buildGraph([
      { id: 'conv1', kind: 'conv2d', inputs: { x: 'graph-input' } },
      { id: 'relu1', kind: 'activation', inputs: { x: ['conv1', 'y'] } },
      { id: 'relu2', kind: 'activation', inputs: { x: ['relu1', 'y'] } },
      { id: 'conv2', kind: 'conv2d', inputs: { x: ['relu2', 'y'] } },
    ])
    expect(validatePortKinds(validationInput(graph))).toEqual([])
  })

  it('接続のないポートについては何も報告しない(別のルールの担当)', () => {
    const graph = buildGraph([{ id: 'conv1', kind: 'conv2d' }])
    expect(validatePortKinds(validationInput(graph))).toEqual([])
  })
})
