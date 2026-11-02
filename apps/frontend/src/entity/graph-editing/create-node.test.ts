// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { addNode, emptyModelGraph } from '../model-graph/model-graph'
import { conv2dType, graphInputType, upsampleType } from '../node-catalog/entries'

import { createNode } from './create-node'

describe('createNode', () => {
  it('<層の種類>_1 の ID と、カタログの既定値のパラメータで作る', () => {
    const node = createNode(conv2dType, emptyModelGraph())
    expect(node).toEqual({
      id: 'conv2d_1',
      spec: {
        kind: 'conv2d',
        params: {
          in_channels: 3,
          out_channels: 64,
          kernel_size: 3,
          stride: 1,
          padding: 1,
          dilation: 1,
        },
      },
      inputs: [],
    })
  })

  it('使われていない最小の番号を振る', () => {
    let graph = emptyModelGraph()
    graph = addNode(graph, createNode(conv2dType, graph))
    graph = addNode(graph, createNode(conv2dType, graph))
    expect(graph.nodes.map((node) => node.id)).toEqual(['conv2d_1', 'conv2d_2'])
    // 違う種類は別に数える
    expect(createNode(upsampleType, graph).id).toBe('upsample_1')
  })

  it('エディタ専用の種類(Input / Output)は作れない', () => {
    expect(() => createNode(graphInputType, emptyModelGraph())).toThrow()
  })
})
