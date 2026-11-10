// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { EditorDocument } from '../../entity/document/document'
import { emptyEditorDocument } from '../../entity/document/document'
import { GRAPH_INPUT_NODE, GRAPH_OUTPUT_NODE } from '../../entity/graph-editing/endpoint'
import type { ModelGraph } from '../../entity/model-graph/model-graph'
import { nodeId } from '../../entity/model-graph/node-id'
import { defaultNodeCatalog } from '../../entity/node-catalog/entries'
import { issueError, issueWarning } from '../../entity/validation/issue'
import type { Issue } from '../../entity/validation/issue'
import { buildGraph, validSegnetGraph } from '../../entity/validation/test-fixtures'
import type { EditorSelection } from '../stores/editor-store'
import { EMPTY_SELECTION } from '../stores/editor-store'

import { DEFAULT_GRAPH_IO_POSITIONS, MODEL_NODE_TYPE, graphToFlow } from './graph-to-flow'

function flowOf(
  graph: ModelGraph,
  options: {
    readonly document?: Partial<EditorDocument>
    readonly selection?: EditorSelection
    readonly issues?: readonly Issue[]
  } = {},
) {
  return graphToFlow({
    document: { ...emptyEditorDocument(), graph, ...options.document },
    catalog: defaultNodeCatalog,
    selection: options.selection ?? EMPTY_SELECTION,
    issues: options.issues ?? [],
  })
}

describe('graphToFlow - ノード', () => {
  it('[Input, ...graph.nodes の順, Output] に並べる', () => {
    const { nodes } = flowOf(validSegnetGraph())
    expect(nodes.map((node) => node.id)).toEqual([
      GRAPH_INPUT_NODE,
      'conv1',
      'relu1',
      'bn1',
      'pool1',
      'unpool1',
      'out_conv',
      GRAPH_OUTPUT_NODE,
    ])
    expect(new Set(nodes.map((node) => node.type))).toEqual(new Set([MODEL_NODE_TYPE]))
  })

  it('空のグラフでも Input と Output は必ず描く', () => {
    expect(flowOf({ nodes: [], outputs: [] }).nodes.map((node) => node.id)).toEqual([
      GRAPH_INPUT_NODE,
      GRAPH_OUTPUT_NODE,
    ])
  })

  it('カタログの定義から、表示名・要約・ポートを作る', () => {
    const conv1 = flowOf(validSegnetGraph()).nodes.find((node) => node.id === 'conv1')
    expect(conv1?.data).toMatchObject({
      typeId: 'conv2d',
      label: 'Conv2D',
      summary: '3→64, k3',
      editorOnly: false,
      unknownType: false,
      unavailable: false,
    })
    expect(conv1?.data.inputs.map((port) => port.name)).toEqual(['x'])
    expect(conv1?.data.outputs.map((port) => port.name)).toEqual(['y'])
  })

  it('Input / Output は消せない(deletable: false)', () => {
    const { nodes } = flowOf(validSegnetGraph())
    const deletable = Object.fromEntries(nodes.map((node) => [node.id, node.deletable]))
    expect(deletable[GRAPH_INPUT_NODE]).toBe(false)
    expect(deletable[GRAPH_OUTPUT_NODE]).toBe(false)
    expect(deletable.conv1).toBe(true)
  })

  it('保存された座標を使い、なければ既定の位置に置く', () => {
    const { nodes } = flowOf(validSegnetGraph(), {
      document: {
        layout: { positions: new Map([['relu1', { x: 123, y: 45 }]]), viewport: null },
      },
    })
    const positionOf = (id: string) => nodes.find((node) => node.id === id)?.position
    expect(positionOf('relu1')).toEqual({ x: 123, y: 45 })
    expect(positionOf(GRAPH_INPUT_NODE)).toEqual(DEFAULT_GRAPH_IO_POSITIONS[GRAPH_INPUT_NODE])
    // 座標のないノードどうしは重ならない
    expect(positionOf('conv1')).not.toEqual(positionOf('bn1'))
  })

  it('選択状態を写す', () => {
    const { nodes } = flowOf(validSegnetGraph(), {
      selection: { nodeIds: [nodeId('bn1')], edgeIds: [] },
    })
    expect(nodes.filter((node) => node.selected).map((node) => node.id)).toEqual(['bn1'])
  })

  it('問題の数と、最も重い severity をノードに付ける', () => {
    const { nodes } = flowOf(validSegnetGraph(), {
      issues: [
        issueWarning('channel/mismatch', 'w', { nodeId: nodeId('bn1') }),
        issueError('param/invalid', 'e', { nodeId: nodeId('bn1') }),
        issueWarning('channel/mismatch', 'w', { nodeId: nodeId('conv1') }),
        issueError('graph/no-nodes', 'グラフ全体の問題'),
      ],
    })
    const dataOf = (id: string) => nodes.find((node) => node.id === id)?.data
    expect(dataOf('bn1')).toMatchObject({ issueSeverity: 'error', issueCount: 2 })
    expect(dataOf('conv1')).toMatchObject({ issueSeverity: 'warning', issueCount: 1 })
    expect(dataOf('relu1')).toMatchObject({ issueSeverity: null, issueCount: 0 })
  })

  it('今の条件で使えないノードに印を付ける(フェーズ 3 の赤色表示の材料)', () => {
    const { nodes } = flowOf(validSegnetGraph(), {
      document: { context: { dataDim: '1d', method: 'cnn' } },
    })
    const conv1 = nodes.find((node) => node.id === 'conv1')
    const input = nodes.find((node) => node.id === GRAPH_INPUT_NODE)
    expect(conv1?.data.unavailable).toBe(true)
    // Input / Output はどの条件でも使える
    expect(input?.data.unavailable).toBe(false)
  })
})

describe('graphToFlow - 線', () => {
  it('Input / Output を含むすべての接続を、ポート名をハンドルにして描く', () => {
    const { edges } = flowOf(validSegnetGraph())
    expect(
      edges.map((e) => `${e.source}.${e.sourceHandle}->${e.target}.${e.targetHandle}`),
    ).toEqual([
      '__input__.y->conv1.x',
      'conv1.y->relu1.x',
      'relu1.y->bn1.x',
      'bn1.y->pool1.x',
      'pool1.y->unpool1.x',
      'pool1.indices->unpool1.indices',
      'unpool1.y->out_conv.x',
      'out_conv.y->__output__.x',
    ])
  })

  it('線を流れるデータの種類を付ける(Any は上流から解決する)', () => {
    const { edges } = flowOf(validSegnetGraph())
    const kindOf = (source: string, port: string) =>
      edges.find((e) => e.source === source && e.sourceHandle === port)?.data?.kind
    expect(kindOf('pool1', 'indices')).toBe('indices')
    // relu1(Activation)の出力は Any だが、上流の conv1 から feature に決まる
    expect(kindOf('relu1', 'y')).toBe('feature')
  })

  it('同じ端点の線が 2 本あっても ID は重ならない(Add の x + x)', () => {
    const graph = buildGraph([
      { id: 'conv1', kind: 'conv2d', inputs: { x: 'graph-input' } },
      {
        id: 'add1',
        kind: 'add',
        inputs: {
          x: [
            ['conv1', 'y'],
            ['conv1', 'y'],
          ],
        },
      },
    ])
    const ids = flowOf(graph).edges.map((edge) => edge.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('関係のない線を消しても、ほかの線の ID は変わらない(選択が別の線に移らない)', () => {
    const before = flowOf(validSegnetGraph()).edges
    const graph = validSegnetGraph()
    const withoutFirst: ModelGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === 'conv1' ? { ...node, inputs: [] } : node)),
    }
    const after = flowOf(withoutFirst).edges
    expect(after.map((edge) => edge.id)).toEqual(before.slice(1).map((edge) => edge.id))
  })

  it('線を外すための位置(ConnectionRef)を data に持たせる', () => {
    const edge = flowOf(validSegnetGraph()).edges.find(
      (e) => e.target === 'unpool1' && e.targetHandle === 'indices',
    )
    expect(edge?.data?.ref).toEqual({ kind: 'input', nodeId: 'unpool1', index: 1 })
  })

  it('存在しないノードを指す線は描かない', () => {
    const graph = buildGraph([{ id: 'conv1', kind: 'conv2d', inputs: { x: ['ghost', 'y'] } }])
    expect(flowOf(graph).edges).toEqual([])
  })

  it('選択状態を写す', () => {
    const first = flowOf(validSegnetGraph()).edges[0]
    if (first === undefined) throw new Error('線がありません')
    const { edges } = flowOf(validSegnetGraph(), {
      selection: { nodeIds: [], edgeIds: [first.id] },
    })
    expect(edges.filter((edge) => edge.selected).map((edge) => edge.id)).toEqual([first.id])
  })
})
