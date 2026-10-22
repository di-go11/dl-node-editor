// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { GraphNode, ModelGraph } from './model-graph'
import {
  addNode,
  appendInput,
  emptyModelGraph,
  findNode,
  inputsOfPort,
  removeInput,
  removeNode,
  renameNode,
  replaceNodeSpec,
  setInput,
  setOutputs,
} from './model-graph'
import { nodeId } from './node-id'
import type { NodeKind } from './node-spec'
import { GRAPH_INPUT, nodeOutput } from './port'

function node(id: string, kind: NodeKind = 'conv2d'): GraphNode {
  return { id: nodeId(id), spec: { kind, params: {} }, inputs: [] }
}

/** conv1 → relu1 → concat1(x に 2 本)という小さなグラフ */
function sampleGraph(): ModelGraph {
  let graph = emptyModelGraph()
  graph = addNode(graph, node('conv1'))
  graph = addNode(graph, node('relu1', 'activation'))
  graph = addNode(graph, node('concat1', 'concat'))
  graph = setInput(graph, nodeId('conv1'), 'x', GRAPH_INPUT)
  graph = setInput(graph, nodeId('relu1'), 'x', nodeOutput(nodeId('conv1'), 'y'))
  graph = appendInput(graph, nodeId('concat1'), 'x', nodeOutput(nodeId('conv1'), 'y'))
  graph = appendInput(graph, nodeId('concat1'), 'x', nodeOutput(nodeId('relu1'), 'y'))
  graph = setOutputs(graph, [nodeOutput(nodeId('concat1'), 'y')])
  return graph
}

describe('addNode', () => {
  it('末尾に足し、既存の並び順を変えない', () => {
    // 並び順は重みの初期化と checkpoint の対応を決めるので、挿入位置は末尾でなければならない
    const graph = sampleGraph()
    const added = addNode(graph, node('bn1', 'batch_norm'))
    expect(added.nodes.map((n) => n.id)).toEqual(['conv1', 'relu1', 'concat1', 'bn1'])
  })

  it('元のグラフを書き換えない(不変)', () => {
    const graph = sampleGraph()
    addNode(graph, node('bn1', 'batch_norm'))
    expect(graph.nodes).toHaveLength(3)
  })
})

describe('setInput', () => {
  it('同じポートの接続を置き換える', () => {
    let graph = sampleGraph()
    graph = setInput(graph, nodeId('relu1'), 'x', nodeOutput(nodeId('conv1'), 'z'))
    const relu1 = findNode(graph, nodeId('relu1'))
    expect(inputsOfPort(relu1!, 'x')).toHaveLength(1)
    expect(inputsOfPort(relu1!, 'x')[0]?.source).toEqual(nodeOutput(nodeId('conv1'), 'z'))
  })
})

describe('appendInput', () => {
  it('複数つなげるポートでは、つないだ順を保つ', () => {
    // Concat はつないだ順にチャンネルが並ぶため、順序が入れ替わると別のモデルになる
    const concat1 = findNode(sampleGraph(), nodeId('concat1'))
    expect(inputsOfPort(concat1!, 'x').map((input) => input.source)).toEqual([
      nodeOutput(nodeId('conv1'), 'y'),
      nodeOutput(nodeId('relu1'), 'y'),
    ])
  })
})

describe('removeInput', () => {
  it('source を指定すればその 1 本だけを外す', () => {
    const graph = removeInput(
      sampleGraph(),
      nodeId('concat1'),
      'x',
      nodeOutput(nodeId('conv1'), 'y'),
    )
    const concat1 = findNode(graph, nodeId('concat1'))
    expect(inputsOfPort(concat1!, 'x').map((input) => input.source)).toEqual([
      nodeOutput(nodeId('relu1'), 'y'),
    ])
  })

  it('source を省けばそのポートのすべてを外す', () => {
    const graph = removeInput(sampleGraph(), nodeId('concat1'), 'x')
    const concat1 = findNode(graph, nodeId('concat1'))
    expect(inputsOfPort(concat1!, 'x')).toHaveLength(0)
  })
})

describe('removeNode', () => {
  it('ノードを消すと、そのノードを指していた接続も消える', () => {
    // 参照だけが残ると「存在しないノードを指す接続」になり proto の制約に違反する
    const graph = removeNode(sampleGraph(), nodeId('conv1'))

    expect(graph.nodes.map((n) => n.id)).toEqual(['relu1', 'concat1'])
    expect(findNode(graph, nodeId('relu1'))?.inputs).toEqual([])
    expect(inputsOfPort(findNode(graph, nodeId('concat1'))!, 'x').map((i) => i.source)).toEqual([
      nodeOutput(nodeId('relu1'), 'y'),
    ])
  })

  it('出力に指定されていたノードを消すと、出力も消える', () => {
    const graph = removeNode(sampleGraph(), nodeId('concat1'))
    expect(graph.outputs).toEqual([])
  })

  it('残ったノードの並び順は変わらない', () => {
    const graph = removeNode(sampleGraph(), nodeId('relu1'))
    expect(graph.nodes.map((n) => n.id)).toEqual(['conv1', 'concat1'])
  })
})

describe('renameNode', () => {
  it('ID を変え、そのノードを指す参照もすべて書き換える', () => {
    const graph = renameNode(sampleGraph(), nodeId('conv1'), nodeId('encoder_conv'))

    expect(graph.nodes.map((n) => n.id)).toEqual(['encoder_conv', 'relu1', 'concat1'])
    expect(findNode(graph, nodeId('relu1'))?.inputs[0]?.source).toEqual(
      nodeOutput(nodeId('encoder_conv'), 'y'),
    )
  })

  it('出力に指定されていた参照も書き換える', () => {
    const graph = renameNode(sampleGraph(), nodeId('concat1'), nodeId('head'))
    expect(graph.outputs).toEqual([nodeOutput(nodeId('head'), 'y')])
  })
})

describe('replaceNodeSpec', () => {
  it('対象のノードだけを差し替える', () => {
    const graph = replaceNodeSpec(sampleGraph(), nodeId('conv1'), {
      kind: 'conv2d',
      params: { out_channels: 128 },
    })
    expect(findNode(graph, nodeId('conv1'))?.spec.params).toEqual({ out_channels: 128 })
    expect(findNode(graph, nodeId('relu1'))?.spec.kind).toBe('activation')
  })
})
