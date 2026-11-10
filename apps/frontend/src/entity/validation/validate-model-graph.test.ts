// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { emptyModelGraph } from '../model-graph/model-graph'

import { buildGraph, validSegnetGraph, validationInput } from './test-fixtures'
import { MODEL_GRAPH_RULES, validateModelGraph } from './validate-model-graph'

describe('validateModelGraph', () => {
  it('test_segnet_dag.json と同じ構造のグラフは検証を通る', () => {
    const result = validateModelGraph(validationInput(validSegnetGraph()))
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('空のグラフは通らない', () => {
    const result = validateModelGraph(validationInput(emptyModelGraph()))
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('graph/no-nodes')
  })

  it('warning だけなら ok は true のまま(実行を止めない)', () => {
    // チャンネル数の不一致は確実な判定ではないため、実行は止めない
    const graph = buildGraph(
      [
        { id: 'conv1', kind: 'conv2d', params: { out_channels: 64 }, inputs: { x: 'graph-input' } },
        {
          id: 'conv2',
          kind: 'conv2d',
          params: { in_channels: 32, out_channels: 3 },
          inputs: { x: ['conv1', 'y'] },
        },
      ],
      [['conv2', 'y']],
    )
    const result = validateModelGraph(validationInput(graph))
    expect(result.issues.map((issue) => issue.code)).toEqual(['channel/mismatch'])
    expect(result.ok).toBe(true)
  })

  it('error が 1 件でもあれば ok は false', () => {
    const graph = buildGraph([{ id: 'conv1', kind: 'conv2d' }], [['conv1', 'y']])
    expect(validateModelGraph(validationInput(graph)).ok).toBe(false)
  })

  it('問題を 1 件目で打ち切らず、すべて集める', () => {
    // model_graph.proto の「見つかった問題はすべて位置付きで返す」と同じ方針。
    // 1 つ直すたびに次が現れる作りだと、修正に何往復も必要になる
    const graph = buildGraph([
      { id: 'conv1', kind: 'conv2d', params: { kernel_size: 0 } },
      { id: 'conv1', kind: 'conv2d', params: { stride: 0 }, inputs: { x: ['missing', 'y'] } },
    ])
    const codes = validateModelGraph(validationInput(graph)).issues.map((issue) => issue.code)

    expect(codes).toContain('node-id/duplicate')
    expect(codes).toContain('graph/no-input')
    expect(codes).toContain('graph/no-output')
    expect(codes).toContain('reference/missing-node')
    expect(codes).toContain('port/not-connected')
    expect(codes).toContain('param/invalid')
  })

  it('error を warning より先に並べる(ログの先頭に原因が来る)', () => {
    const graph = buildGraph([
      { id: 'conv1', kind: 'conv2d', params: { out_channels: 64 }, inputs: { x: 'graph-input' } },
      { id: 'conv2', kind: 'conv2d', params: { in_channels: 32 }, inputs: { x: ['conv1', 'y'] } },
    ])
    const issues = validateModelGraph(validationInput(graph)).issues

    const firstWarningIndex = issues.findIndex((issue) => issue.severity === 'warning')
    const lastErrorIndex = issues.map((issue) => issue.severity).lastIndexOf('error')
    expect(firstWarningIndex).toBeGreaterThan(lastErrorIndex)
  })

  it('知らない層の種類があっても、ほかのルールが Issue を重ねない', () => {
    // 1 つの原因に対して「ポートが不明」「パラメータが不明」と並ぶと原因が埋もれる。
    // node-types が報告したノードは、ほかのルールが黙って飛ばす設計になっている
    const graph = {
      ...validSegnetGraph(),
      nodes: validSegnetGraph().nodes.map((node) =>
        node.id === 'relu1'
          ? { ...node, spec: { ...node.spec, kind: 'flatten' as typeof node.spec.kind } }
          : node,
      ),
    }
    const issues = validateModelGraph(validationInput(graph)).issues
    const relu1Issues = issues.filter((issue) => issue.nodeId === 'relu1')
    expect(relu1Issues.map((issue) => issue.code)).toEqual(['node/unknown-type'])
  })

  it('1D に切り替えても、グラフの構造そのものは通る(条件の不一致だけが残る)', () => {
    const result = validateModelGraph(
      validationInput(validSegnetGraph(), { dataDim: '1d', method: 'cnn' }),
    )
    expect(new Set(result.issues.map((issue) => issue.code))).toEqual(
      new Set(['node/unavailable-in-context']),
    )
    expect(result.ok).toBe(false)
  })
})

describe('ルールの構成', () => {
  it('すべてのルールが純粋関数として独立に呼べる', () => {
    // 同じ入力に対して同じ結果を返すこと(副作用がないこと)を確かめる
    const input = validationInput(validSegnetGraph())
    for (const rule of MODEL_GRAPH_RULES) {
      expect(rule(input)).toEqual(rule(input))
    }
  })

  it('ルールを増やしたら validateModelGraph に反映される', () => {
    expect(MODEL_GRAPH_RULES).toHaveLength(10)
  })
})
