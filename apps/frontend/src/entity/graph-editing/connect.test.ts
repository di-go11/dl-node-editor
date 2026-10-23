// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { ModelGraph } from '../model-graph/model-graph'
import { findNode } from '../model-graph/model-graph'
import { nodeId } from '../model-graph/node-id'
import { GRAPH_INPUT, nodeOutput } from '../model-graph/port'
import { defaultNodeCatalog } from '../node-catalog/entries'
import { graphInputType, graphOutputType } from '../node-catalog/entries/graph-io'
import { buildGraph, validSegnetGraph } from '../validation/test-fixtures'

import { checkConnection, connect, disconnect, disconnectAll } from './connect'
import type { SourceEndpoint, TargetEndpoint } from './endpoint'
import {
  GRAPH_INPUT_NODE,
  GRAPH_INPUT_PORT,
  GRAPH_OUTPUT_NODE,
  GRAPH_OUTPUT_PORT,
  connectionsOf,
  portRefToSource,
  sourceToPortRef,
} from './endpoint'

const catalog = defaultNodeCatalog

const src = (node: string, port = 'y'): SourceEndpoint =>
  node === GRAPH_INPUT_NODE
    ? { node: GRAPH_INPUT_NODE, port: GRAPH_INPUT_PORT }
    : { node: nodeId(node), port }

const dst = (node: string, port = 'x'): TargetEndpoint =>
  node === GRAPH_OUTPUT_NODE
    ? { node: GRAPH_OUTPUT_NODE, port: GRAPH_OUTPUT_PORT }
    : { node: nodeId(node), port }

/** 接続のない conv / relu / add / pool / unpool が並んだグラフ */
function looseGraph(): ModelGraph {
  return buildGraph([
    { id: 'conv1', kind: 'conv2d' },
    { id: 'conv2', kind: 'conv2d' },
    { id: 'relu1', kind: 'activation' },
    { id: 'add1', kind: 'add' },
    { id: 'pool1', kind: 'indexed_pooling' },
    { id: 'unpool1', kind: 'unpooling' },
  ])
}

function connected(graph: ModelGraph, source: SourceEndpoint, target: TargetEndpoint): ModelGraph {
  const result = connect(graph, catalog, source, target)
  if (!result.ok) throw new Error(result.reason)
  return result.graph
}

describe('端点と ModelGraph の対応', () => {
  it('Input / Output のポート名がカタログの定義と一致する', () => {
    expect(graphInputType.outputs.map((port) => port.name)).toEqual([GRAPH_INPUT_PORT])
    expect(graphOutputType.inputs.map((port) => port.name)).toEqual([GRAPH_OUTPUT_PORT])
  })

  it('Input の出力は GRAPH_INPUT に、GRAPH_INPUT は Input の出力に対応する', () => {
    expect(sourceToPortRef(src(GRAPH_INPUT_NODE))).toEqual(GRAPH_INPUT)
    expect(portRefToSource(GRAPH_INPUT)).toEqual(src(GRAPH_INPUT_NODE))
    expect(sourceToPortRef(src('conv1'))).toEqual(nodeOutput(nodeId('conv1'), 'y'))
  })

  it('connectionsOf は Input / Output を含めた接続を、決まった順で列挙する', () => {
    const connections = connectionsOf(validSegnetGraph())
    expect(
      connections.map(
        (c) => `${c.source.node}.${c.source.port}->${c.target.node}.${c.target.port}`,
      ),
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
    expect(connections.at(-1)?.ref).toEqual({ kind: 'output', index: 0 })
    expect(connections[5]?.ref).toEqual({ kind: 'input', nodeId: 'unpool1', index: 1 })
  })
})

describe('checkConnection - 許すもの', () => {
  it('Input → Conv2D', () => {
    expect(checkConnection(looseGraph(), catalog, src(GRAPH_INPUT_NODE), dst('conv1'))).toEqual({
      ok: true,
    })
  })

  it('Conv2D → Output', () => {
    expect(checkConnection(looseGraph(), catalog, src('conv1'), dst(GRAPH_OUTPUT_NODE)).ok).toBe(
      true,
    )
  })

  it('indices → Unpooling.indices(同じ種類どうし)', () => {
    const check = checkConnection(
      looseGraph(),
      catalog,
      src('pool1', 'indices'),
      dst('unpool1', 'indices'),
    )
    expect(check.ok).toBe(true)
  })

  it('上流が未接続で Any の種類が決まらなければ、拒否しない(判定は整合性チェックに任せる)', () => {
    // relu1 には何もつながっていないので、出力の種類は決まらない
    expect(checkConnection(looseGraph(), catalog, src('relu1'), dst('conv1')).ok).toBe(true)
  })

  it('複数つなげないポートに既に接続があっても許す(connect が置き換える)', () => {
    const graph = connected(looseGraph(), src(GRAPH_INPUT_NODE), dst('conv1'))
    expect(checkConnection(graph, catalog, src('conv2'), dst('conv1')).ok).toBe(true)
  })
})

describe('checkConnection - 拒否するもの', () => {
  const codeOf = (graph: ModelGraph, source: SourceEndpoint, target: TargetEndpoint) => {
    const check = checkConnection(graph, catalog, source, target)
    return check.ok ? 'ok' : check.code
  }

  it('自分自身への接続', () => {
    expect(codeOf(looseGraph(), src('conv1'), dst('conv1'))).toBe('self-loop')
  })

  it('Input → Output の直結(outputs はグラフ入力を指せない)', () => {
    expect(codeOf(looseGraph(), src(GRAPH_INPUT_NODE), dst(GRAPH_OUTPUT_NODE))).toBe(
      'input-to-output',
    )
  })

  it('閉路になる接続', () => {
    // conv1 → conv2 があるところに conv2 → conv1 をつなぐと輪になる
    const graph = connected(looseGraph(), src('conv1'), dst('conv2'))
    expect(codeOf(graph, src('conv2'), dst('conv1'))).toBe('cycle')
  })

  it('離れた場所を経由する閉路も見つける', () => {
    let graph = connected(looseGraph(), src('conv1'), dst('relu1'))
    graph = connected(graph, src('relu1'), dst('conv2'))
    expect(codeOf(graph, src('conv2'), dst('conv1'))).toBe('cycle')
  })

  it('indices を特徴マップの入力につなぐ', () => {
    expect(codeOf(looseGraph(), src('pool1', 'indices'), dst('conv1'))).toBe('kind-mismatch')
  })

  it('特徴マップを Unpooling.indices につなぐ', () => {
    expect(codeOf(looseGraph(), src('conv1'), dst('unpool1', 'indices'))).toBe('kind-mismatch')
  })

  it('Any の出力は上流をたどって種類を決めてから判定する', () => {
    // pool1.indices → relu1.x は connect では作れない(Any は indices を受けない)が、
    // 手で書いたファイルを読み込めばこの状態になりうる。このとき relu1.y の実体は indices。
    // 宣言どおり Any として比べると conv1.x(feature)につなげてしまうので、解決が要る
    const graph = buildGraph([
      { id: 'pool1', kind: 'indexed_pooling', inputs: { x: 'graph-input' } },
      { id: 'relu1', kind: 'activation', inputs: { x: ['pool1', 'indices'] } },
      { id: 'conv1', kind: 'conv2d' },
    ])
    expect(codeOf(graph, src('relu1'), dst('conv1'))).toBe('kind-mismatch')
  })

  it('存在しないノード・ポート', () => {
    expect(codeOf(looseGraph(), src('ghost'), dst('conv1'))).toBe('unknown-node')
    expect(codeOf(looseGraph(), src('conv1', 'z'), dst('conv1', 'x'))).toBe('unknown-port')
    expect(codeOf(looseGraph(), src('conv1'), dst('conv2', 'w'))).toBe('unknown-port')
  })
})

describe('connect', () => {
  it('Input からの接続は GRAPH_INPUT になる', () => {
    const graph = connected(looseGraph(), src(GRAPH_INPUT_NODE), dst('conv1'))
    expect(findNode(graph, nodeId('conv1'))?.inputs).toEqual([{ port: 'x', source: GRAPH_INPUT }])
  })

  it('Output への接続は outputs を置き換える(Output は当面 1 つ)', () => {
    let graph = connected(looseGraph(), src('conv1'), dst(GRAPH_OUTPUT_NODE))
    graph = connected(graph, src('conv2'), dst(GRAPH_OUTPUT_NODE))
    expect(graph.outputs).toEqual([nodeOutput(nodeId('conv2'), 'y')])
  })

  it('複数つなげないポートは置き換える', () => {
    let graph = connected(looseGraph(), src(GRAPH_INPUT_NODE), dst('conv2'))
    graph = connected(graph, src('conv1'), dst('conv2'))
    expect(findNode(graph, nodeId('conv2'))?.inputs).toEqual([
      { port: 'x', source: nodeOutput(nodeId('conv1'), 'y') },
    ])
  })

  it('複数つなげるポート(Add.x)は、つないだ順に末尾へ足す', () => {
    let graph = connected(looseGraph(), src('conv1'), dst('add1'))
    graph = connected(graph, src('conv2'), dst('add1'))
    expect(findNode(graph, nodeId('add1'))?.inputs.map((input) => input.source)).toEqual([
      nodeOutput(nodeId('conv1'), 'y'),
      nodeOutput(nodeId('conv2'), 'y'),
    ])
  })

  it('拒否された接続ではグラフを変えずに理由を返す', () => {
    const graph = looseGraph()
    const result = connect(graph, catalog, src('conv1'), dst('conv1'))
    expect(result).toMatchObject({ ok: false, code: 'self-loop' })
    expect(result.ok ? result.graph : graph).toBe(graph)
  })

  it('ノードの並び順を変えない', () => {
    const graph = connected(looseGraph(), src('unpool1'), dst('conv1'))
    expect(graph.nodes.map((node) => node.id)).toEqual(looseGraph().nodes.map((node) => node.id))
  })
})

describe('disconnect', () => {
  it('Add に同じ出力を 2 本つないでも、1 本だけ外せる', () => {
    let graph = connected(looseGraph(), src('conv1'), dst('add1'))
    graph = connected(graph, src('conv1'), dst('add1'))
    const removed = disconnect(graph, { kind: 'input', nodeId: nodeId('add1'), index: 1 })
    expect(findNode(removed, nodeId('add1'))?.inputs).toHaveLength(1)
  })

  it('Output への接続を外す', () => {
    const graph = connected(looseGraph(), src('conv1'), dst(GRAPH_OUTPUT_NODE))
    expect(disconnect(graph, { kind: 'output', index: 0 }).outputs).toEqual([])
  })

  it('まとめて外しても、位置のずれで別の接続を外さない', () => {
    let graph = connected(looseGraph(), src('conv1'), dst('add1'))
    graph = connected(graph, src('conv2'), dst('add1'))
    graph = connected(graph, src('relu1'), dst('add1'))
    // 0 番目と 2 番目を外す。0 番目を先に外すと、2 番目は 1 番目にずれてしまう
    const removed = disconnectAll(graph, [
      { kind: 'input', nodeId: nodeId('add1'), index: 0 },
      { kind: 'input', nodeId: nodeId('add1'), index: 2 },
    ])
    expect(findNode(removed, nodeId('add1'))?.inputs.map((input) => input.source)).toEqual([
      nodeOutput(nodeId('conv2'), 'y'),
    ])
  })
})
