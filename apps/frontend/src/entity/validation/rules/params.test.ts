// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { ModelGraph } from '../../model-graph/model-graph'
import { nodeId } from '../../model-graph/node-id'
import { GRAPH_INPUT } from '../../model-graph/port'
import { buildGraph, validSegnetGraph, validationInput } from '../test-fixtures'

import { validateParams } from './params'

const codesOf = (issues: readonly { code: string }[]): readonly string[] =>
  issues.map((issue) => issue.code)

describe('validateParams', () => {
  it('正しいグラフでは何も報告しない', () => {
    expect(validateParams(validationInput(validSegnetGraph()))).toEqual([])
  })

  it('kernel_size に 0 を入れたら報告する', () => {
    // 制約はカタログの ParamDef(min: 1)に 1 か所だけ書いてある
    const graph = buildGraph([
      { id: 'conv1', kind: 'conv2d', params: { kernel_size: 0 }, inputs: { x: 'graph-input' } },
    ])
    const issues = validateParams(validationInput(graph))
    expect(codesOf(issues)).toEqual(['param/invalid'])
    // プロパティパネルが該当の入力欄の横に出せるよう、パラメータ名を持たせる
    expect(issues[0]).toMatchObject({ nodeId: 'conv1', paramName: 'kernel_size' })
  })

  it('小数を整数のパラメータに入れたら報告する', () => {
    const graph = buildGraph([
      { id: 'conv1', kind: 'conv2d', params: { kernel_size: 2.5 }, inputs: { x: 'graph-input' } },
    ])
    expect(codesOf(validateParams(validationInput(graph)))).toEqual(['param/invalid'])
  })

  it('eps に 0 を入れたら報告する(exclusiveMin なので 0 は不可)', () => {
    const graph = buildGraph([
      { id: 'bn1', kind: 'batch_norm', params: { eps: 0 }, inputs: { x: 'graph-input' } },
    ])
    const issues = validateParams(validationInput(graph))
    expect(issues[0]).toMatchObject({ code: 'param/invalid', paramName: 'eps' })
  })

  it('enum に選択肢外の値を入れたら報告する', () => {
    const graph = buildGraph([
      {
        id: 'relu1',
        kind: 'activation',
        params: { activation_type: 'ACTIVATION_TYPE_GELU' },
        inputs: { x: 'graph-input' },
      },
    ])
    const issues = validateParams(validationInput(graph))
    expect(issues[0]).toMatchObject({ code: 'param/invalid', paramName: 'activation_type' })
  })

  it('パラメータが欠けていたら param/missing として報告する', () => {
    // 古い版で保存したファイルに、後から増えたパラメータがない場合に起こる
    const graph: ModelGraph = {
      nodes: [
        {
          id: nodeId('conv1'),
          spec: { kind: 'conv2d', params: { in_channels: 3 } },
          inputs: [{ port: 'x', source: GRAPH_INPUT }],
        },
      ],
      outputs: [],
    }
    const issues = validateParams(validationInput(graph))
    expect(new Set(codesOf(issues))).toEqual(new Set(['param/missing']))
    expect(issues.map((issue) => issue.paramName).sort()).toEqual([
      'dilation',
      'kernel_size',
      'out_channels',
      'padding',
      'stride',
    ])
  })

  it('定義にないパラメータを param/unknown として報告する(綴り間違いの検出)', () => {
    const graph = buildGraph([
      {
        id: 'conv1',
        kind: 'conv2d',
        params: { kernelSize: 3 },
        inputs: { x: 'graph-input' },
      },
    ])
    const issues = validateParams(validationInput(graph))
    expect(codesOf(issues)).toEqual(['param/unknown'])
    expect(issues[0]?.message).toContain('kernelSize')
  })

  it('問題を 1 件目で打ち切らず、すべて報告する', () => {
    const graph = buildGraph([
      {
        id: 'conv1',
        kind: 'conv2d',
        params: { kernel_size: 0, stride: 0, dilation: 0 },
        inputs: { x: 'graph-input' },
      },
    ])
    expect(validateParams(validationInput(graph))).toHaveLength(3)
  })

  it('パラメータのないノード(Concat)では何も報告しない', () => {
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
    expect(validateParams(validationInput(graph))).toEqual([])
  })
})
