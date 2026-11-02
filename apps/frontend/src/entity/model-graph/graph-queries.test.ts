// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  danglingSources,
  dependencyIdsOf,
  findCycle,
  graphInputConsumers,
  sourceOfPort,
  topologicalOrder,
  upstreamNodeIds,
} from './graph-queries'
import type { GraphNode, ModelGraph } from './model-graph'
import { nodeId } from './node-id'
import type { NodeKind } from './node-spec'
import { GRAPH_INPUT, nodeOutput } from './port'

/** `inputs` を直接書いてグラフを組む(操作関数を経由せず、構造そのものを検査するため) */
function node(
  id: string,
  kind: NodeKind,
  inputs: readonly { port: string; from?: readonly [string, string] }[] = [],
): GraphNode {
  return {
    id: nodeId(id),
    spec: { kind, params: {} },
    inputs: inputs.map((input) => ({
      port: input.port,
      source:
        input.from === undefined ? GRAPH_INPUT : nodeOutput(nodeId(input.from[0]), input.from[1]),
    })),
  }
}

/**
 * test_segnet_dag.json と同じ形(indices を使う分岐がある):
 *   conv1 → relu1 → bn1 → pool1 ─┬─ y ──────▶ unpool1(x)
 *                                └─ indices ─▶ unpool1(indices)
 */
function segnetLike(): ModelGraph {
  return {
    nodes: [
      node('conv1', 'conv2d', [{ port: 'x' }]),
      node('relu1', 'activation', [{ port: 'x', from: ['conv1', 'y'] }]),
      node('bn1', 'batch_norm', [{ port: 'x', from: ['relu1', 'y'] }]),
      node('pool1', 'indexed_pooling', [{ port: 'x', from: ['bn1', 'y'] }]),
      node('unpool1', 'unpooling', [
        { port: 'x', from: ['pool1', 'y'] },
        { port: 'indices', from: ['pool1', 'indices'] },
      ]),
    ],
    outputs: [nodeOutput(nodeId('unpool1'), 'y')],
  }
}

describe('dependencyIdsOf', () => {
  it('同じノードの別ポートから 2 本来ていても 1 回だけ数える', () => {
    // unpool1 は pool1 の y と indices の両方につながっているが、依存先は pool1 の 1 つ
    const unpool1 = segnetLike().nodes[4]
    expect(dependencyIdsOf(unpool1!)).toEqual(['pool1'])
  })

  it('グラフ入力は依存先に含めない', () => {
    const conv1 = segnetLike().nodes[0]
    expect(dependencyIdsOf(conv1!)).toEqual([])
  })
})

describe('sourceOfPort', () => {
  it('ポート名で接続元を引ける', () => {
    const unpool1 = segnetLike().nodes[4]
    expect(sourceOfPort(unpool1!, 'indices')).toEqual(nodeOutput(nodeId('pool1'), 'indices'))
  })

  it('つながっていないポートは undefined', () => {
    const unpool1 = segnetLike().nodes[4]
    expect(sourceOfPort(unpool1!, 'bogus')).toBeUndefined()
  })
})

describe('graphInputConsumers', () => {
  it('グラフ入力を受け取っているノードを返す', () => {
    expect(graphInputConsumers(segnetLike())).toEqual(['conv1'])
  })

  it('グラフ入力がどこにもなければ空', () => {
    const graph: ModelGraph = {
      nodes: [node('a', 'conv2d', [{ port: 'x', from: ['b', 'y'] }])],
      outputs: [],
    }
    expect(graphInputConsumers(graph)).toEqual([])
  })
})

describe('danglingSources', () => {
  it('存在しないノードへの参照を位置付きで返す', () => {
    const graph: ModelGraph = {
      nodes: [node('a', 'conv2d', [{ port: 'x', from: ['missing', 'y'] }])],
      outputs: [],
    }
    expect(danglingSources(graph)).toEqual([{ nodeId: 'a', port: 'x', missingNodeId: 'missing' }])
  })

  it('正しいグラフでは空', () => {
    expect(danglingSources(segnetLike())).toEqual([])
  })
})

describe('findCycle', () => {
  it('閉路がなければ null', () => {
    expect(findCycle(segnetLike())).toBeNull()
  })

  it('2 ノードの閉路を見つける', () => {
    const graph: ModelGraph = {
      nodes: [
        node('a', 'conv2d', [{ port: 'x', from: ['b', 'y'] }]),
        node('b', 'conv2d', [{ port: 'x', from: ['a', 'y'] }]),
      ],
      outputs: [],
    }
    const cycle = findCycle(graph)
    // 依存をたどった順に返し、閉じていることを示すため先頭の ID で終わる
    expect(cycle).toEqual(['a', 'b', 'a'])
  })

  it('自分自身への接続も閉路として見つける', () => {
    const graph: ModelGraph = {
      nodes: [node('a', 'conv2d', [{ port: 'x', from: ['a', 'y'] }])],
      outputs: [],
    }
    expect(findCycle(graph)).toEqual(['a', 'a'])
  })

  it('存在しないノードへの参照では閉路と判定しない', () => {
    // dangling は別の問題。1 つの検査が複数の問題を兼ねないようにしている
    const graph: ModelGraph = {
      nodes: [node('a', 'conv2d', [{ port: 'x', from: ['missing', 'y'] }])],
      outputs: [],
    }
    expect(findCycle(graph)).toBeNull()
  })
})

describe('topologicalOrder', () => {
  it('上流から下流の順に返す', () => {
    expect(topologicalOrder(segnetLike())).toEqual(['conv1', 'relu1', 'bn1', 'pool1', 'unpool1'])
  })

  it('nodes の並びが実行順と逆でも、正しい実行順を返す', () => {
    const graph: ModelGraph = {
      nodes: [
        node('second', 'activation', [{ port: 'x', from: ['first', 'y'] }]),
        node('first', 'conv2d', [{ port: 'x' }]),
      ],
      outputs: [],
    }
    expect(topologicalOrder(graph)).toEqual(['first', 'second'])
  })

  it('nodes の並び順そのものは変えない(問い合わせであって並べ替えではない)', () => {
    const graph: ModelGraph = {
      nodes: [
        node('second', 'activation', [{ port: 'x', from: ['first', 'y'] }]),
        node('first', 'conv2d', [{ port: 'x' }]),
      ],
      outputs: [],
    }
    topologicalOrder(graph)
    expect(graph.nodes.map((n) => n.id)).toEqual(['second', 'first'])
  })

  it('閉路があれば null', () => {
    const graph: ModelGraph = {
      nodes: [
        node('a', 'conv2d', [{ port: 'x', from: ['b', 'y'] }]),
        node('b', 'conv2d', [{ port: 'x', from: ['a', 'y'] }]),
      ],
      outputs: [],
    }
    expect(topologicalOrder(graph)).toBeNull()
  })
})

describe('upstreamNodeIds', () => {
  it('推移的に上流をすべて返す', () => {
    expect([...upstreamNodeIds(segnetLike(), nodeId('unpool1'))].sort()).toEqual([
      'bn1',
      'conv1',
      'pool1',
      'relu1',
    ])
  })

  it('最上流のノードの上流は空', () => {
    expect([...upstreamNodeIds(segnetLike(), nodeId('conv1'))]).toEqual([])
  })
})
