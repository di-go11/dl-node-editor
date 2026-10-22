// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { buildGraph, validSegnetGraph, validationInput } from '../test-fixtures'

import { validateChannelConsistency } from './channel-consistency'

const run = (graph: Parameters<typeof validationInput>[0]) =>
  validateChannelConsistency(validationInput(graph))

describe('validateChannelConsistency', () => {
  it('正しいグラフでは何も報告しない', () => {
    expect(run(validSegnetGraph())).toEqual([])
  })

  it('severity は warning である', () => {
    // C++ は形状を確認しないので本来は error にしたいが、フロントが追跡できるのは
    // 一部の経路だけ。確実でない検査で実行を止めると正しいモデルが組めなくなる
    const graph = buildGraph([
      { id: 'conv1', kind: 'conv2d', params: { out_channels: 64 }, inputs: { x: 'graph-input' } },
      { id: 'conv2', kind: 'conv2d', params: { in_channels: 32 }, inputs: { x: ['conv1', 'y'] } },
    ])
    const issues = run(graph)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
  })

  it('Conv2D の in_channels が上流の out_channels と違えば報告する', () => {
    const graph = buildGraph([
      { id: 'conv1', kind: 'conv2d', params: { out_channels: 64 }, inputs: { x: 'graph-input' } },
      { id: 'conv2', kind: 'conv2d', params: { in_channels: 32 }, inputs: { x: ['conv1', 'y'] } },
    ])
    const issues = run(graph)
    expect(issues[0]).toMatchObject({
      code: 'channel/mismatch',
      nodeId: 'conv2',
      paramName: 'in_channels',
    })
    expect(issues[0]?.message).toContain('32')
    expect(issues[0]?.message).toContain('64')
  })

  it('そのまま通す層(Activation / Pooling)をまたいでも追跡する', () => {
    const graph = buildGraph([
      { id: 'conv1', kind: 'conv2d', params: { out_channels: 64 }, inputs: { x: 'graph-input' } },
      { id: 'relu1', kind: 'activation', inputs: { x: ['conv1', 'y'] } },
      { id: 'pool1', kind: 'pooling2d', inputs: { x: ['relu1', 'y'] } },
      { id: 'conv2', kind: 'conv2d', params: { in_channels: 32 }, inputs: { x: ['pool1', 'y'] } },
    ])
    expect(run(graph)).toHaveLength(1)
  })

  it('BatchNorm の num_features が上流と違えば報告する', () => {
    const graph = buildGraph([
      { id: 'conv1', kind: 'conv2d', params: { out_channels: 64 }, inputs: { x: 'graph-input' } },
      {
        id: 'bn1',
        kind: 'batch_norm',
        params: { num_features: 32 },
        inputs: { x: ['conv1', 'y'] },
      },
    ])
    expect(run(graph)[0]).toMatchObject({ nodeId: 'bn1', paramName: 'num_features' })
  })

  it('Concat の後は入力の合計チャンネル数になる', () => {
    const graph = buildGraph([
      { id: 'a', kind: 'conv2d', params: { out_channels: 64 }, inputs: { x: 'graph-input' } },
      { id: 'b', kind: 'conv2d', params: { out_channels: 32 }, inputs: { x: 'graph-input' } },
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
      // 64 + 32 = 96 なので、96 なら報告しない
      { id: 'conv2', kind: 'conv2d', params: { in_channels: 96 }, inputs: { x: ['cat1', 'y'] } },
    ])
    expect(run(graph)).toEqual([])
  })

  it('Concat の後のチャンネル数を間違えていれば報告する', () => {
    const graph = buildGraph([
      { id: 'a', kind: 'conv2d', params: { out_channels: 64 }, inputs: { x: 'graph-input' } },
      { id: 'b', kind: 'conv2d', params: { out_channels: 32 }, inputs: { x: 'graph-input' } },
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
      { id: 'conv2', kind: 'conv2d', params: { in_channels: 64 }, inputs: { x: ['cat1', 'y'] } },
    ])
    expect(run(graph)[0]?.message).toContain('96')
  })

  it('Add の入力のチャンネル数がそろっていなければ報告する', () => {
    const graph = buildGraph([
      { id: 'a', kind: 'conv2d', params: { out_channels: 64 }, inputs: { x: 'graph-input' } },
      { id: 'b', kind: 'conv2d', params: { out_channels: 32 }, inputs: { x: 'graph-input' } },
      {
        id: 'add1',
        kind: 'add',
        inputs: {
          x: [
            ['a', 'y'],
            ['b', 'y'],
          ],
        },
      },
    ])
    const issues = run(graph)
    expect(issues[0]).toMatchObject({ code: 'channel/mismatch', nodeId: 'add1', port: 'x' })
    expect(issues[0]?.message).toContain('64 と 32')
  })

  it('Add の入力がそろっていれば報告しない', () => {
    const graph = buildGraph([
      { id: 'a', kind: 'conv2d', params: { out_channels: 64 }, inputs: { x: 'graph-input' } },
      { id: 'b', kind: 'conv2d', params: { out_channels: 64 }, inputs: { x: 'graph-input' } },
      {
        id: 'add1',
        kind: 'add',
        inputs: {
          x: [
            ['a', 'y'],
            ['b', 'y'],
          ],
        },
      },
    ])
    expect(run(graph)).toEqual([])
  })

  it('グラフ入力の直後は追跡しない(チャンネル数がデータセット次第で分からない)', () => {
    // 指示書「追跡できない経路はチェックしない」。
    // data_spec にもチャンネル数は含まれないため、確かめようがない
    const graph = buildGraph([
      { id: 'conv1', kind: 'conv2d', params: { in_channels: 99 }, inputs: { x: 'graph-input' } },
    ])
    expect(run(graph)).toEqual([])
  })

  it('Linear は追跡しない(in_features は Flatten 後の要素数でチャンネル数ではない)', () => {
    const graph = buildGraph([
      { id: 'conv1', kind: 'conv2d', params: { out_channels: 64 }, inputs: { x: 'graph-input' } },
      { id: 'fc1', kind: 'linear', params: { in_features: 512 }, inputs: { x: ['conv1', 'y'] } },
    ])
    expect(run(graph)).toEqual([])
  })

  it('indices の経路は追跡しない(チャンネルという概念を持たない)', () => {
    const graph = buildGraph([
      { id: 'conv1', kind: 'conv2d', params: { out_channels: 64 }, inputs: { x: 'graph-input' } },
      { id: 'pool1', kind: 'indexed_pooling', inputs: { x: ['conv1', 'y'] } },
      {
        id: 'conv2',
        kind: 'conv2d',
        params: { in_channels: 1 },
        inputs: { x: ['pool1', 'indices'] },
      },
    ])
    expect(run(graph)).toEqual([])
  })

  it('閉路があっても止まらない(閉路そのものは別のルールが報告する)', () => {
    const graph = buildGraph([
      { id: 'a', kind: 'conv2d', inputs: { x: ['b', 'y'] } },
      { id: 'b', kind: 'conv2d', inputs: { x: ['a', 'y'] } },
    ])
    expect(() => run(graph)).not.toThrow()
  })
})
